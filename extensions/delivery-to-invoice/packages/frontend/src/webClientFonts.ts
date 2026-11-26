/**
 * The extension runs inside an iframe of the SAP B1 Web Client. UI5 font loading is disabled
 * (see main.tsx) and the Web Client serves its "72" fonts under a build-specific, hashed path
 * (e.g. /webx/~1777897510868~/flp/themes/base/fonts/72-Bold.woff2), so the URLs cannot be hardcoded.
 * Instead, copy the "72" @font-face rules from the parent document (same origin) into this one.
 */
export function inheritWebClientFonts(): void {
  try {
    const parentDoc = window.parent !== window ? window.parent.document : null;
    if (!parentDoc) return;

    const css: string[] = [];
    for (const sheet of Array.from(parentDoc.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet
      }
      const base = sheet.href ?? parentDoc.baseURI;
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof (window.parent as unknown as typeof window).CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
        if (family !== '72' && family !== '72full' && family !== '72Mono' && family !== '72Black') continue;
        const text = rule.cssText.replace(/url\((["']?)([^)"']+)\1\)/g, (_m, _q, url: string) => {
          try {
            return `url("${new URL(url, base).href}")`;
          } catch {
            return _m;
          }
        });
        css.push(text);
      }
    }

    if (css.length > 0) {
      const style = document.createElement('style');
      style.dataset.source = 'sap-web-client-fonts';
      style.textContent = css.join('\n');
      document.head.appendChild(style);
    }
  } catch {
    // Standalone mode or cross-origin parent: fall back to the system fonts.
  }
}
