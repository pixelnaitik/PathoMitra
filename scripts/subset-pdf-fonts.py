"""Regenerate the bundled PDF font subsets from the installed Expo Noto packages.

Requires fontTools (`python -m pip install fonttools`). The generated TTFs are
committed so normal npm/CI installs do not need Python or network access.
"""

from pathlib import Path
from fontTools import subset

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "node_modules" / "@expo-google-fonts"
OUTPUT = ROOT / "src" / "assets" / "pdf-fonts"

BASE = set(range(0x20, 0x100)) | set(range(0x2000, 0x2070)) | {0x20AC, 0x20B9}
FONTS = [
    ("noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf", "NotoSansDevanagari-Regular.ttf", range(0x0900, 0x0980)),
    ("noto-sans-devanagari/700Bold/NotoSansDevanagari_700Bold.ttf", "NotoSansDevanagari-Bold.ttf", range(0x0900, 0x0980)),
    ("noto-sans/400Regular/NotoSans_400Regular.ttf", "NotoSans-Regular.ttf", range(0x0370, 0x0530)),
    ("noto-sans/700Bold/NotoSans_700Bold.ttf", "NotoSans-Bold.ttf", range(0x0370, 0x0530)),
    ("noto-sans-bengali/400Regular/NotoSansBengali_400Regular.ttf", "NotoSansBengali-Regular.ttf", range(0x0980, 0x0A00)),
    ("noto-sans-gujarati/400Regular/NotoSansGujarati_400Regular.ttf", "NotoSansGujarati-Regular.ttf", range(0x0A80, 0x0B00)),
    ("noto-sans-gurmukhi/400Regular/NotoSansGurmukhi_400Regular.ttf", "NotoSansGurmukhi-Regular.ttf", range(0x0A00, 0x0A80)),
    ("noto-sans-kannada/400Regular/NotoSansKannada_400Regular.ttf", "NotoSansKannada-Regular.ttf", range(0x0C80, 0x0D00)),
    ("noto-sans-malayalam/400Regular/NotoSansMalayalam_400Regular.ttf", "NotoSansMalayalam-Regular.ttf", range(0x0D00, 0x0D80)),
    ("noto-sans-oriya/400Regular/NotoSansOriya_400Regular.ttf", "NotoSansOriya-Regular.ttf", range(0x0B00, 0x0B80)),
    ("noto-sans-tamil/400Regular/NotoSansTamil_400Regular.ttf", "NotoSansTamil-Regular.ttf", range(0x0B80, 0x0C00)),
    ("noto-sans-telugu/400Regular/NotoSansTelugu_400Regular.ttf", "NotoSansTelugu-Regular.ttf", range(0x0C00, 0x0C80)),
    ("noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf", "NotoSansArabic-Regular.ttf", range(0x0600, 0x0700)),
    ("noto-sans-hebrew/400Regular/NotoSansHebrew_400Regular.ttf", "NotoSansHebrew-Regular.ttf", range(0x0590, 0x0600)),
    ("noto-sans-math/400Regular/NotoSansMath_400Regular.ttf", "NotoSansMath-Regular.ttf", range(0x2190, 0x2400)),
]

OUTPUT.mkdir(parents=True, exist_ok=True)
for source, name, script_range in FONTS:
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    font = subset.load_font(str(PACKAGES / source), options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=BASE | set(script_range))
    subsetter.subset(font)
    destination = OUTPUT / name
    subset.save_font(font, str(destination), options)
    print(f"{name}: {destination.stat().st_size} bytes")
