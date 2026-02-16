/**
 * Configuração PM2 para Rei do Churrasco WhatsApp Bot
 * 
 * PM2 é um gerenciador de processos Node.js que:
 * - Mantém o bot rodando 24/7
 * - Reinicia automaticamente em caso de crash
 * - Gerencia logs automaticamente
 * - Permite monitoramento em tempo real
 * 
 * Comandos úteis:
 *   pm2 start ecosystem.config.cjs     - Inicia o bot
 *   pm2 stop rei-bot                   - Para o bot
 *   pm2 restart rei-bot                - Reinicia o bot
 *   pm2 logs rei-bot                   - Ver logs em tempo real
 *   pm2 monit                          - Dashboard de monitoramento
 *   pm2 save                           - Salva lista de processos
 *   pm2 startup                        - Configura início automático no boot
 */

module.exports = {
    apps: [
        {
            name: 'rei-bot',
            script: 'src/index.js',

            // Variáveis de ambiente
            env: {
                NODE_ENV: 'production',
                PORT: 3016
            },

            // Configurações de reinício
            watch: false,
            autorestart: true,
            max_restarts: 10,
            min_uptime: '10s',
            restart_delay: 5000,

            // Gerenciamento de memória
            max_memory_restart: '500M',

            // Logs
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            error_file: './logs/error.log',
            out_file: './logs/out.log',
            merge_logs: true,

            // Cluster (usar 1 instância para bot WhatsApp)
            instances: 1,
            exec_mode: 'fork',

            // Graceful shutdown
            kill_timeout: 5000,
            wait_ready: true,
            listen_timeout: 10000
        }
    ]
}
