const { withGradleProperties } = require("expo/config-plugins");

const FULL_MODE = "android.enableR8.fullMode";

// SDK 58 release builds minify with R8 full mode. Full mode constant-folds
// Class.getCanonicalName() into a string that ends in ".canonicalName", so
// WorkManager's startup initializer looks up WorkDatabase.canonicalName and
// the process dies in InitializationProvider. Compatibility mode keeps the
// real class name. The Room and InputMerger keep rules stay; they do not
// stop this fold.
function withDisableR8FullMode(config) {
  return withGradleProperties(config, (config) => {
    const items = config.modResults;
    const existing = items.find((item) => item.type === "property" && item.key === FULL_MODE);
    if (existing) {
      existing.value = "false";
      return config;
    }

    items.push(
      { type: "empty" },
      {
        type: "comment",
        value:
          "Compatibility mode. Full mode folds Class.getCanonicalName() to a string ending in .canonicalName and crashes WorkManager startup.",
      },
      { type: "property", key: FULL_MODE, value: "false" },
    );
    return config;
  });
}

module.exports = withDisableR8FullMode;
