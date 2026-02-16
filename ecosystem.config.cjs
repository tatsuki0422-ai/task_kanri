module.exports = {
  apps: [
    {
      name: 'task-kanri',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=webapp-production --local --ip 127.0.0.1 --port 3000',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
}
