#!/usr/bin/env node

const net = require("net");
const readline = require("readline");

let exit = false;
const socket = net.createConnection({ host: "localhost", port: 5000 }, () => {
    console.log("Connected to CLI server. Type 'help' for available commands.");
    prompt();
});

socket.on("data", (data) => {
    console.log(data.toString());
    if (data.toString() === "shutdown") {
        console.log("Exiting CLI.");
        socket.end();
        process.exit(0);
    }
    prompt();
});

socket.on("end", () => {
    console.log("Disconnected from CLI server.");
    process.exit(0);
});

socket.on("error", (err) => {
    console.error("Connection error:", err.message);
    process.exit(1);
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function prompt() {
    rl.question("cli> ", (line) => {
        if (line === "shutdown") {
            exit = true;
        }
        socket.write(line);
    });
}

rl.on("close", () => {
    console.log("Exiting CLI.");
    socket.end();
});
