const fs = require("fs");
const path = require("path");
require("dotenv").config(); // Load environment variables

// Define configuration directory (supports global installation)
const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), "config");
const apiConfigPath = path.join(configDir, "apiConfig.json");
const cmsConfigPath = path.join(configDir, "cmsConfig.json");

// Load CMS theme from environment variable
const cmsTheme = process.env.CMS_THEME || "default";

/**
 * Maps database column types to UI field types
 */
function mapFieldType(columnType) {
  const type = columnType.toLowerCase();
  if (type.includes("int")) return "number";
  if (type.includes("varchar") || type.includes("char")) return "text";
  if (type.includes("text")) return "textarea";
  if (type.includes("boolean") || type.includes("tinyint(1)")) return "checkbox";
  if (type.includes("date") || type.includes("timestamp")) return "date";
  return "text"; // Default type
}

/**
 * Determines the form type based on the table name
 */
function determineFormType(tableName) {
  if (tableName.includes("page") || tableName.includes("content")) return "wysiwyg";
  if (tableName.includes("video")) return "video_preview";
  if (tableName.includes("image") || tableName.includes("media")) return "image_editor";
  return "default"; // Default form type
}

/**
 * Determines the list type based on the table name
 */
function determineListType(tableName) {
  if (tableName.includes("media") || tableName.includes("image") || tableName.includes("video")) return "video-gallery";
  if (tableName.includes("content") || tableName.includes("page")) return "list";
  return "table"; // Default list type
}

/**
 * Generates the CMS configuration based on the API config
 */
function generateCmsConfig() {
  if (!fs.existsSync(apiConfigPath)) {
    console.error(`Error: apiConfig.json not found at ${apiConfigPath}`);
    return;
  }

  const apiConfig = JSON.parse(fs.readFileSync(apiConfigPath, "utf8"));
  const cmsConfig = {
    cms: {
      name: "Adaptus2 CMS",
      version: "1.0",
      theme: cmsTheme, // Adding the theme attribute
      tables: {},
    },
  };

  apiConfig.forEach((tableConfig) => {
    if (!tableConfig.dbTable ||!tableConfig.route) return; // Skip invalid configurations
    // slips every table that is not a database or dynamic route

    if(tableConfig.routeType != "database" && !tableConfig.routeType != "dynamic") {
      return;
    }
    const { dbTable, route, allowRead = [], allowWrite = [], columnDefinitions = {} } = tableConfig;
    const fields = {};

    Object.entries(columnDefinitions).forEach(([field, type]) => {
      const readonly = allowWrite.includes(field) ? false : true;
      fields[field] = {
        label: field.replace(/_/g, " ").toUpperCase(),
        type: mapFieldType(type),
        readonly: readonly,
        hidden: allowRead.includes(field) ? false : true,
        validation: {
          required: !readonly, // If readonly is false, then required is true
          maxLength: type.match(/\((\d+)\)/) ? parseInt(type.match(/\((\d+)\)/)[1]) : undefined,
        },
        ui: {
          template: mapFieldType(type) === "textarea" ? "rich-text-editor" : "input",
          placeholder: `Enter ${field.replace(/_/g, " ")}`,
        },
      };
    });

    cmsConfig.cms.tables[dbTable] = {
      dbTable,
      title: dbTable.replace(/_/g, " ").toUpperCase(),
      route: `${route}`,
      permissions: {
        read: allowRead.length > 0,
        write: allowWrite.length > 0,
        delete: true, // Assuming delete is allowed for all
      },
      fields,
      listView: {
        list_type: determineListType(dbTable), // Assigns table, grid, or list
        displayFields: Object.keys(fields).slice(0, 3), // Show first 3 fields in table
        sortableFields: Object.keys(fields),
        filterableFields: Object.keys(fields).filter((f) => fields[f].type === "text"),
      },
      detailView: {
        form_type: determineFormType(dbTable), // Assigns wysiwyg, video preview, etc.
        tabs: {
          General: Object.keys(fields),
        },
      },
    };
  });

  fs.writeFileSync(cmsConfigPath, JSON.stringify(cmsConfig, null, 2));
  console.log("✅ cmsConfig.json has been generated successfully!");
}

module.exports = { generateCmsConfig };

// Auto-run if executed directly
if (require.main === module) {
  generateCmsConfig();
}
