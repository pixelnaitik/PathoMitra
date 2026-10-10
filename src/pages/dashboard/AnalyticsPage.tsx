import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from 'recharts';
import { Users, Activity, TestTube, FileText } from 'lucide-react';
import { collection, onSnapshot, query, where, db, type QueryConstraint } from '../../data/fs';
import { readPatients, readReports, type PatientRecord, type ReportRecord } from '../../lib/models';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { cn } from '../../lib/utils';
import { findTestInfo } from '../../lib/pathology-tests';
import { CalendarRangePicker, Card, SectionTitle, toIsoDay } from '../../components/ui';
import { localDayEndIso, localDayStartIso } from '../../lib/date-range';

/** Reads a CSS custom property from <html> so charts follow the active palette + color mode. */
const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Light-mode fallbacks, used only for the very first paint before the effect resolves the real vars.
const CHART_FALLBACK = {
  c1: '#0a6cbe',
  c2: '#0e8c7f',
  c3: '#7c4dff',
  c4: '#e8930c',
  c5: '#d64550',
  c6: '#3fa45b',
  grid: '#d2d2d7',
  tick: '#6e6e73',
  surface: '#ffffff',
  border: '#d2d2d7',
  onSurface: '#1d1d1f',
};

export default function AnalyticsPage() {
  const [fromDate, setFromDate] = useState(() => {
    // default to 7 days ago
    const d = new Date();
    d.setDate(d.getDate() - 7);
    // `toIsoDay` formats the *local* day. `toISOString().split('T')[0]` would
    // convert to UTC first, so before 05:30 IST the default range would end
    // yesterday and today's reports would fall out of their own chart.
    return toIsoDay(d);
  });
  const [toDate, setToDate] = useState(() => toIsoDay(new Date()));

  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [patients, setPatients] = useState<PatientRecord[]>([]);

  // Chart colors are resolved from CSS custom properties (never at module scope —
  // getComputedStyle would break SSR/tests) and re-read whenever the palette or
  // color mode changes.
  const [chartColors, setChartColors] = useState<Record<string, string>>({});

  useEffect(() => {
    const readChartColors = () => {
      setChartColors({
        c1: cssVar('--chart-1'),
        c2: cssVar('--chart-2'),
        c3: cssVar('--chart-3'),
        c4: cssVar('--chart-4'),
        c5: cssVar('--chart-5'),
        c6: cssVar('--chart-6'),
        grid: cssVar('--outline-variant'),
        tick: cssVar('--on-surface-variant'),
        surface: cssVar('--surface-container-lowest'),
        border: cssVar('--outline-variant'),
        onSurface: cssVar('--on-surface'),
      });
    };
    readChartColors();
    window.addEventListener('settings-updated', readChartColors);
    return () => window.removeEventListener('settings-updated', readChartColors);
  }, []);

  const cc = (key: keyof typeof CHART_FALLBACK) => chartColors[key] || CHART_FALLBACK[key];
  const pieColors = [cc('c1'), cc('c2'), cc('c3'), cc('c4'), cc('c5'), cc('c6')];
  const tooltipContentStyle = {
    backgroundColor: cc('surface'),
    borderColor: cc('border'),
    borderWidth: 1,
    borderRadius: 16,
    color: cc('onSurface'),
    boxShadow: '0 16px 40px -12px rgb(0 0 0 / 0.25)',
    fontSize: 12,
  };

  useEffect(() => {
    // Charts only ever aggregate the selected window, so the window is what gets
    // read. Both collections used to be streamed in full into memory for every
    // visit to this page, billed per document on every change in the lab.
    const withinRange = (field: string): QueryConstraint[] => {
      const constraints: QueryConstraint[] = [];
      // Local-day bounds, because the aggregation below buckets by `toIsoDay`.
      // `${fromDate}T00:00:00.000Z` is UTC midnight, which in UTC+5:30 excludes
      // everything created before 05:30 — the chart's own dots and totals then
      // disagreed with the rows it had actually read.
      const since = localDayStartIso(fromDate);
      const until = localDayEndIso(toDate);
      if (since) constraints.push(where(field, '>=', since));
      if (until) constraints.push(where(field, '<=', until));
      return constraints;
    };

    const unsubReports = onSnapshot(
      query(collection(db, 'reports'), ...withinRange('createdAt')),
      s => setReports(readReports(s.docs)),
      error => handleFirestoreError(error, OperationType.GET, 'reports'),
    );

    const unsubPatients = onSnapshot(
      query(collection(db, 'patients'), ...withinRange('createdAt')),
      s => setPatients(readPatients(s.docs)),
      error => handleFirestoreError(error, OperationType.GET, 'patients'),
    );

    return () => {
      unsubReports();
      unsubPatients();
    };
  }, [fromDate, toDate]);

  const activeReportDates = useMemo(() => {
    return new Set(reports.filter(r => r.createdAt).map(r => toIsoDay(new Date(r.createdAt))));
  }, [reports]);

  const { filteredReports } = useMemo(() => {
    // Defensive re-check on the local day: a document whose `createdAt` cannot be
    // parsed must not silently land inside every range.
    const fr = reports.filter(r => {
      if (!r.createdAt) return false;
      const createdAtStr = toIsoDay(new Date(r.createdAt));
      if (fromDate && createdAtStr < fromDate) return false;
      if (toDate && createdAtStr > toDate) return false;
      return true;
    });

    return { filteredReports: fr };
  }, [reports, fromDate, toDate]);

  const trendData = useMemo(() => {
    const daily: Record<string, { tests: number; reports: number }> = {};

    // Generate dates between fromDate and toDate
    const arr: string[] = [];
    if (fromDate && toDate) {
      const start = new Date(fromDate);
      const end = new Date(toDate);
      const limit = new Date(start);
      // Let's cap at max 90 days to prevent chart layout explosions if range is huge
      let count = 0;
      while (limit <= end && count < 90) {
        const dateStr = limit.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
        daily[dateStr] = { tests: 0, reports: 0 };
        arr.push(dateStr);
        limit.setDate(limit.getDate() + 1);
        count++;
      }
    } else {
      // Default to last 7 days if not set
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
        daily[dateStr] = { tests: 0, reports: 0 };
        arr.push(dateStr);
      }
    }

    filteredReports.forEach(r => {
      if (!r.createdAt) return;
      const d = new Date(r.createdAt);
      const dateStr = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
      if (daily[dateStr]) {
        daily[dateStr].reports += 1;
        // Tests per report: the ordered panel first, then whatever was actually
        // recorded. (`r.results`/`r.tests` never existed on a report document,
        // so this used to fall through to "1" for every report.)
        const testsCount = r.testSelection?.length || Object.keys(r.resultData || {}).length;
        daily[dateStr].tests += testsCount || 1;
      }
    });

    return arr.map(dateStr => ({
      name: dateStr,
      ...daily[dateStr],
    }));
  }, [filteredReports, fromDate, toDate]);

  // Both breakdown charts used to share one dataset bucketed by `testType`, which
  // most reports never carry — so each rendered a single "Other" shape. Categories
  // come from the test catalogue; volume from the tests actually ordered, with
  // group headers left out because their members are counted individually.
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredReports.forEach(r => {
      (r.testSelection || []).forEach(name => {
        const category = findTestInfo(name)?.category || 'Other';
        counts[category] = (counts[category] || 0) + 1;
      });
    });

    return Object.keys(counts)
      .map(k => ({ name: k, value: counts[k] }))
      .sort((a, b) => b.value - a.value);
  }, [filteredReports]);

  const topTestsData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredReports.forEach(r => {
      (r.testSelection || []).forEach(name => {
        const info = findTestInfo(name);
        if (info?.isGroup || info?.isHeader) return;
        counts[name] = (counts[name] || 0) + 1;
      });
    });

    return Object.keys(counts)
      .map(k => ({ name: k, value: counts[k] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredReports]);

  const patientInsightsData = useMemo(() => {
    let newP = 0;
    let recurringP = 0;
    const counts: Record<string, number> = {};
    reports.forEach(r => {
      if (r.patientId) {
        counts[r.patientId] = (counts[r.patientId] || 0) + 1;
      }
    });

    Object.values(counts).forEach(c => {
      if (c > 1) recurringP++;
      else newP++;
    });

    if (newP === 0 && recurringP === 0) return [{ name: 'No Data', value: 1 }];

    return [
      { name: 'New Patients', value: newP },
      { name: 'Recurring Patients', value: recurringP },
    ];
  }, [reports]);

  const topDoctors = useMemo(() => {
    // A report carries no doctor — the referral lives on the patient. Joining
    // through `patientId` is what makes this chart more than one "Unknown
    // Doctor" bar.
    const doctorByPatient = new Map(patients.map(p => [p.id, p.doctorName || 'Unknown Doctor']));
    const stats: Record<string, { patients: Set<string>; reports: number }> = {};
    reports.forEach(r => {
      const docName = doctorByPatient.get(r.patientId) || 'Unknown Doctor';
      if (!stats[docName]) stats[docName] = { patients: new Set(), reports: 0 };
      stats[docName].reports += 1;
      if (r.patientId) stats[docName].patients.add(r.patientId);
    });

    return Object.keys(stats)
      .map(k => ({
        name: k,
        patients: stats[k].patients.size,
        reports: stats[k].reports,
      }))
      .sort((a, b) => b.reports - a.reports)
      .slice(0, 5);
  }, [reports, patients]);

  const totalReports = trendData.reduce((acc, curr) => acc + curr.reports, 0);
  const totalTests = trendData.reduce((acc, curr) => acc + curr.tests, 0);

  return (
    <div className="space-y-6">
      <Card
        pad="md"
        className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
      >
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.03em] text-on-surface">Dashboard</h2>
          <p className="text-sm text-on-surface-variant">Overview of your lab performance</p>
        </div>

        <CalendarRangePicker
          fromDate={fromDate}
          toDate={toDate}
          activeDates={activeReportDates}
          onChange={({ fromDate: from, toDate: to }) => {
            setFromDate(from);
            setToDate(to);
          }}
          className="z-30 w-full sm:w-64"
        />
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 fold:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Reports',
            value: totalReports.toLocaleString(),
            sub: 'finalized in selected range',
            icon: FileText,
            tint: 'bg-chart-1/12 text-chart-1',
          },
          {
            label: 'Total Tests',
            value: totalTests.toLocaleString(),
            sub: 'tests ordered in range',
            icon: TestTube,
            tint: 'bg-chart-2/12 text-chart-2',
          },
          {
            label: 'Unique Patients',
            value: patients.length.toLocaleString(),
            sub: 'unique registered patients',
            icon: Users,
            tint: 'bg-chart-3/12 text-chart-3',
          },
          {
            label: 'Avg Tests/Patient',
            value: totalReports > 0 ? (totalTests / patients.length).toFixed(1) : '0',
            sub: 'completed tests per patient',
            icon: Activity,
            tint: 'bg-chart-4/12 text-chart-4',
          },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, type: 'spring', stiffness: 260, damping: 24 }}
            className="flex"
          >
            <Card className="flex w-full flex-col justify-between gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
                    {kpi.label}
                  </p>
                  <h4 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.03em] text-on-surface tabular-nums">
                    {kpi.value}
                  </h4>
                </div>
                <div
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                    kpi.tint,
                  )}
                >
                  <kpi.icon className="w-5 h-5" aria-hidden="true" />
                </div>
              </div>
              <p className="text-[11px] font-medium text-on-surface-variant">{kpi.sub}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Row 2: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Report Volume Trend */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-[360px]"
        >
          <Card pad="lg" className="flex h-full flex-col">
            <SectionTitle
              title="Report Volume Trend"
              action={
                <span className="shrink-0 rounded-full bg-surface-container px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
                  Selected range
                </span>
              }
            />
            <div className="flex-1 w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorReports" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={cc('c1')} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={cc('c1')} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={cc('grid')}
                    strokeOpacity={0.5}
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: cc('tick') }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: cc('tick') }}
                  />
                  <RechartsTooltip contentStyle={tooltipContentStyle} />
                  <Area
                    type="monotone"
                    dataKey="reports"
                    stroke={cc('c1')}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorReports)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        {/* Test Volume Trend */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="h-[360px]"
        >
          <Card pad="lg" className="flex h-full flex-col">
            <SectionTitle
              title="Test Volume Trend"
              action={
                <span className="shrink-0 rounded-full bg-surface-container px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
                  Selected range
                </span>
              }
            />
            <div className="flex-1 w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTests" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={cc('c2')} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={cc('c2')} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={cc('grid')}
                    strokeOpacity={0.5}
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: cc('tick') }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: cc('tick') }}
                  />
                  <RechartsTooltip contentStyle={tooltipContentStyle} />
                  <Area
                    type="monotone"
                    dataKey="tests"
                    stroke={cc('c2')}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorTests)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Row 3: Splits & Tops */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-1 h-[320px]"
        >
          <Card pad="lg" className="flex h-full flex-col">
            <SectionTitle title="Test Category Distribution" />
            <div className="flex-1 w-full relative flex items-center justify-center">
              {categoryData.length === 0 ? (
                <p className="text-sm text-on-surface-variant">No data available</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {categoryData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={tooltipContentStyle} />
                    <Legend
                      layout="vertical"
                      verticalAlign="middle"
                      align="right"
                      iconType="circle"
                      wrapperStyle={{ fontSize: '12px', color: cc('tick') }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
              {categoryData.length > 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pr-[100px]">
                  <span
                    className="text-sm font-semibold text-on-surface truncate max-w-[100px] text-center"
                    title={categoryData[0].name}
                  >
                    {categoryData[0].name}
                  </span>
                  <span className="text-xs text-on-surface-variant">Top Category</span>
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 h-[320px]"
        >
          <Card pad="lg" className="flex h-full flex-col">
            <SectionTitle title="Top Tests by Volume" />
            <div className="flex-1 w-full min-h-0">
              {topTestsData.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-on-surface-variant">No data available</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topTestsData}
                    layout="vertical"
                    margin={{ top: 0, right: 30, left: 30, bottom: 0 }}
                    barSize={12}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke={cc('grid')}
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      type="number"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: cc('tick') }}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: cc('onSurface') }}
                      width={120}
                    />
                    <RechartsTooltip
                      cursor={{ fill: 'transparent' }}
                      contentStyle={tooltipContentStyle}
                    />
                    <Bar dataKey="value" fill={cc('c3')} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Row 4: Patient Insights & Doctors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="lg:col-span-1 h-[300px]"
        >
          <Card pad="lg" className="flex h-full flex-col">
            <SectionTitle title="Patient Insights" subtitle="New vs recurring patients" />
            <div className="flex-1 w-full relative flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={patientInsightsData}
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    <Cell fill={cc('c2')} />
                    <Cell fill={cc('c1')} />
                    <Cell fill={cc('grid')} />
                  </Pie>
                  <RechartsTooltip contentStyle={tooltipContentStyle} />
                  <Legend
                    layout="vertical"
                    verticalAlign="middle"
                    align="right"
                    iconType="circle"
                    wrapperStyle={{ fontSize: '12px', color: cc('tick') }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pr-[100px]">
                <span className="text-lg font-bold text-on-surface tabular-nums">
                  {patients.length}
                </span>
                <span className="text-[9px] uppercase tracking-[0.08em] text-on-surface-variant">
                  Total Patients
                </span>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="lg:col-span-2 h-[300px]"
        >
          <Card pad="lg" className="flex h-full flex-col overflow-hidden">
            <SectionTitle title="Top Referring Doctors" subtitle="Ranked by reports generated" />
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant">
                    <th className="pb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant w-1/2 text-left">
                      Doctor
                    </th>
                    <th className="pb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant text-right">
                      Patients
                    </th>
                    <th className="pb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant text-right">
                      Reports Generated
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {topDoctors.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-sm text-on-surface-variant">
                        No data available
                      </td>
                    </tr>
                  ) : (
                    topDoctors.map((doc, idx) => (
                      <tr key={idx} className="transition-colors hover:bg-surface-container-low/50">
                        <td className="py-3 text-sm font-semibold text-on-surface text-left">
                          {doc.name}
                        </td>
                        <td className="py-3 text-sm text-on-surface-variant text-right tabular-nums">
                          {doc.patients}
                        </td>
                        <td className="py-3 text-sm font-medium text-on-surface text-right tabular-nums">
                          {doc.reports}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
