const fs = require('fs');
const path = require('path');

const source = path.resolve(__dirname, '../src/db/migrations');
const destination = path.resolve(__dirname, '../dist/db/migrations');

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
