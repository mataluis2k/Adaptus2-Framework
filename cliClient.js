#!/usr/bin/env node

const net = require("net");
const readline = require("readline");
require("dotenv").config();

const parseArgs = () => {
    const args = {};
    const argv = process.argv.slice(2);

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];

      if (arg.startsWith('--')) {
        // Handle --key=value format
        if (arg.includes('=')) {
          const [key, value] = arg.substring(2).split('=');
          args[key] = value;
        }
        // Handle --key value format
        else {
          const key = arg.substring(2);
          const nextArg = argv[i + 1];

          // Make sure the next argument exists and is not another flag
          if (nextArg && !nextArg.startsWith('--')) {
            args[key] = nextArg;
            i++; // Skip the next argument since we've used it as a value
          } else {
            // Flag without value, set to true
            args[key] = true;
          }
        }
      }
    }

    return args;
  };

  const args = parseArgs();
  console.log('Command line arguments:', args);

  // Get port from command line args, environment variable, or default to 3000
  const port = args.port || process.env.SOCKET_CLI_PORT || 5000;

  // Get host/IP from command line args, environment variable, or default to 0.0.0.0 (all interfaces)
  const host = args.ip || args.host || process.env.HOST || process.env.IP || '127.0.0.1';

// ANSI color codes for terminal output
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m"
};

function tryParseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

function formatValue(value, indent = 0, isArrayItem = false) {
    const spaces = ' '.repeat(indent);
    const itemPrefix = isArrayItem ? '- ' : '';

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const items = value.map(item =>
            `${spaces}  ${itemPrefix}${formatValue(item, indent + 2, true)}`
        ).join('\n');
        return value.length === 1 ? items : `\n${items}`;
    }

    if (value === null) return colors.dim + 'null' + colors.reset;

    if (typeof value === 'object') {
        if (Object.keys(value).length === 0) return '{}';
        const entries = Object.entries(value).map(([key, val]) => {
            const formattedVal = formatValue(val, indent + 2);
            const multiline = formattedVal.includes('\n');
            const separator = multiline ? ':\n' : ': ';
            return `${spaces}  ${itemPrefix}${colors.cyan}${key}${colors.reset}${separator}${formattedVal}`;
        }).join('\n');
        return isArrayItem ? entries : `\n${entries}`;
    }

    if (typeof value === 'string') {
        // Check if it's a date string
        const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
        if (datePattern.test(value)) {
            return colors.yellow + value + colors.reset;
        }
        return colors.green + value + colors.reset;
    }
    if (typeof value === 'number') return colors.yellow + value + colors.reset;
    if (typeof value === 'boolean') return colors.blue + value + colors.reset;

    return value;
}

function beautifyOutput(data) {
    const str = data.toString().trim();
    const json = tryParseJSON(str);

    if (json) {
        // If it's JSON, format it nicely
        const formatted = formatValue(json);
        // Add a border around the output
        const width = process.stdout.columns || 80;
        const border = '─'.repeat(width);
        return `\n${colors.dim}${border}${colors.reset}\n${formatted}\n${colors.dim}${border}${colors.reset}\n`;
    } else if (str.startsWith('Error:')) {
        // Format error messages in red with border
        const width = process.stdout.columns || 80;
        const border = '─'.repeat(width);
        return `\n${colors.red}${border}\n${str}\n${border}${colors.reset}\n`;
    } else {
        // Return original string for non-JSON output
        return str;
    }
}

let exit = false;
const socket = net.createConnection({ host: host, port: port }, () => {
    console.log(colors.bright + "Connected to CLI server. Type 'help' for available commands." + colors.reset);
    prompt();
});

socket.on("data", (data) => {
    console.log(beautifyOutput(data));
    if (data.toString() === "shutdown") {
        console.log("Exiting CLI.");
        socket.end();
        process.exit(0);
    }
    prompt();
});

socket.on("end", () => {
    console.log(colors.dim + "Disconnected from CLI server." + colors.reset);
    process.exit(0);
});

socket.on("error", (err) => {
    console.error(colors.red + "Connection error:" + colors.reset, err.message);
    process.exit(1);
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function prompt() {
    rl.question(colors.bright + "cli> " + colors.reset, (line) => {
        if (line === "shutdown") {
            exit = true;
        }
        // Avoid sending empty lines
        if (line.trim() === "") {
            prompt();
            return;
        }
        socket.write(line);
    });
}

rl.on("close", () => {
    console.log(colors.dim + "Exiting CLI." + colors.reset);
    socket.end();
});
