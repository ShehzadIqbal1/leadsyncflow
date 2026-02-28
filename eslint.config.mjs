import js from "@eslint/js";
import globals from "globals";

export default [
  // 1. Tell ESLint how to handle standard JS rules
  js.configs.recommended,
  
  {
    // 2. This section is for your actual Backend code
    files: ["**/*.{js,cjs}"], 
    languageOptions: {
      sourceType: "commonjs", // Allows 'require' in your project files
      globals: {
        ...globals.node,
        ...globals.es2021
      }
    },
    rules: {
      "prefer-const": "error", 
      "no-unused-vars": "warn",
      "no-console": "off"
    }
  },

  {
    // 3. This section specifically handles this config file (.mjs)
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module", // Allows 'import/export' for this file
      globals: {
        ...globals.node
      }
    }
  }
];