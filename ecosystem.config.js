module.exports = { apps: [{ name: 'moneyhunter', script: 'server.js', instances: 1, exec_mode: 'fork', env: { NODE_ENV: 'production', PORT: 8787 }, max_memory_restart: '300M' }] };
