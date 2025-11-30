module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        panel: "var(--panel)",
        textPrim: "var(--text-primary)",
        textSec: "var(--text-secondary)",
        textMuted: "var(--text-muted)",
        accent: "var(--accent)",
        accentHover: "var(--accent-strong)",
        accentSoft: "var(--accent-soft)",
        border: "var(--border-subtle)",
        borderStrong: "var(--border-strong)",
        divider: "var(--divider)",
        rowHover: "var(--table-row-hover)",
        error: "var(--error)",
        errorSoft: "var(--error-soft)",
        success: "var(--success)",
        successSoft: "var(--success-soft)",
        warning: "var(--warning)",
        warningSoft: "var(--warning-soft)",
        info: "var(--info)",
        infoSoft: "var(--info-soft)"
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        float: "var(--shadow-float)"
      }
    }
  },
  plugins: []
};
