module.exports = {
  apps: [
    {
      name: "thermostat-backend",
      script: "dist/index.js",
      watch: false,
      env: {
        NODE_ENV: "production"
      },
      instances: 1, // Podrías usar 'max' si más adelante tenés un server más potente
      autorestart: true,
      max_memory_restart: "200M", // reinicia si se pasa de memoria
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm Z"
    }
  ]
}