/**
 * Bot WhatsApp - Rei do Churrasco
 * Notificações automáticas de pedidos usando Baileys v7
 * Envia notificação para cliente e entregador (quando delivery)
 * Verifica entregadores cadastrados no Supabase
 */

import 'dotenv/config'

import {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    Browsers
} from '@whiskeysockets/baileys'
import pino from 'pino'
import express from 'express'
import cors from 'cors'
import qrcode from 'qrcode-terminal'

import { supabase, buscarEntregadoresAtivos, verificarEntregador } from './lib/supabase.js'
import { useSupabaseAuthState, limparSessao, verificarSessaoExistente } from './lib/authStateSupabase.js'
import {
    gerarMensagemPedidoRecebido,
    gerarMensagemStatusAtualizado,
    gerarMensagemEntregador,
    gerarMensagemCliente
} from './lib/mensagens.js'
import { processarMensagemRecebida } from './lib/respostasAutomaticas.js'

// Configurações
const PORTA = process.env.PORT || 3016
const USAR_SUPABASE_AUTH = process.env.USE_SUPABASE_AUTH === 'true'
const NUMERO_LOJA = process.env.NUMERO_LOJA || ''

// Logger otimizado para produção
const logger = pino({
    level: process.env.LOG_LEVEL || 'info'
})

// Estado global do socket
let sock = null
let qrCodeAtual = null
let statusConexao = 'desconectado'
let numeroConectado = null
let nomePerfil = null
let conectadoEm = null
let saveCreds = null

// Controle de reconexão para evitar loop infinito
let contadorQrCodes = 0
let estaAutenticado = false
let tentativasReconexao = 0
const MAX_TENTATIVAS_RECONEXAO = 5
const DELAY_BASE_RECONEXAO_MS = 3000

// Cache de entregadores (atualizado a cada 5 minutos)
let cacheEntregadores = []
let ultimaAtualizacaoCache = null
const INTERVALO_CACHE_MS = 5 * 60 * 1000 // 5 minutos

// Estatísticas
let estatisticas = {
    mensagensRecebidas: 0,
    mensagensEnviadas: 0,
    pedidosNotificados: 0
}

/**
 * Atualiza cache de entregadores do Supabase
 */
async function atualizarCacheEntregadores() {
    try {
        cacheEntregadores = await buscarEntregadoresAtivos()
        ultimaAtualizacaoCache = Date.now()
        logger.info(`[CACHE] ${cacheEntregadores.length} entregador(es) ativo(s) carregado(s)`)

        if (cacheEntregadores.length > 0) {
            cacheEntregadores.forEach(e => {
                logger.info(`[CACHE] Entregador: ${e.nome} - Tel: ${e.telefone}`)
            })
        }
    } catch (erro) {
        logger.error('[CACHE] Erro ao atualizar cache de entregadores:', erro.message)
    }
}

/**
 * Obtém entregadores (do cache ou atualiza se necessário)
 */
async function obterEntregadores() {
    const agora = Date.now()
    if (!ultimaAtualizacaoCache || (agora - ultimaAtualizacaoCache) > INTERVALO_CACHE_MS) {
        await atualizarCacheEntregadores()
    }
    return cacheEntregadores
}

/**
 * Formata número de telefone para o padrão WhatsApp
 * Formato correto: 55 + DDD (2 dígitos) + número (8 dígitos)
 */
function formatarNumeroWhatsApp(telefone) {
    if (!telefone) return null

    // Remove tudo que não for número
    let numero = telefone.replace(/\D/g, '')

    // Se não começar com 55 (Brasil), adiciona
    if (!numero.startsWith('55')) {
        numero = '55' + numero
    }

    // Formato brasileiro: 55 + DDD (2) + 9 + número (8) = 13 dígitos
    // WhatsApp usa: 55 + DDD (2) + número (8) = 12 dígitos
    if (numero.length === 13 && numero.startsWith('55')) {
        const ddd = numero.substring(2, 4)
        const nono = numero.substring(4, 5)
        const resto = numero.substring(5)

        // Se o 5º dígito é 9 (indicador de celular), remove
        if (nono === '9') {
            numero = '55' + ddd + resto
        }
    }

    return numero + '@s.whatsapp.net'
}

/**
 * Envia mensagem de texto
 */
async function enviarMensagem(telefone, mensagem) {
    if (!sock || statusConexao !== 'conectado') {
        logger.warn('[BOT] Socket não conectado, mensagem não enviada')
        return false
    }

    const jid = formatarNumeroWhatsApp(telefone)
    if (!jid) {
        logger.warn('[BOT] Número de telefone inválido:', telefone)
        return false
    }

    try {
        logger.info(`[BOT] Enviando para JID: ${jid}`)
        await sock.sendMessage(jid, { text: mensagem })
        estatisticas.mensagensEnviadas++
        logger.info(`[BOT] ✅ Mensagem enviada para ${jid}`)
        return true
    } catch (erro) {
        logger.error(`[BOT] ❌ Erro ao enviar para ${jid}:`, erro.message)
        return false
    }
}

/**
 * Processa novo pedido e envia notificações
 * - Envia para o CLIENTE (se tiver telefone)
 * - Envia para a loja
 * - Se for delivery, envia para todos os entregadores ativos do Supabase
 */
async function processarNovoPedido(pedido) {
    const telefoneCLiente = pedido.customer_phone || pedido.telefone
    const numeroPedido = pedido.order_number || pedido.id?.slice(0, 8)
    const orderType = pedido.order_type || pedido.tipo_entrega || ''

    // 1. Envia confirmação para o CLIENTE (prioridade)
    if (telefoneCLiente) {
        const mensagemCliente = gerarMensagemCliente(pedido)
        const enviadoCliente = await enviarMensagem(telefoneCLiente, mensagemCliente)

        if (enviadoCliente) {
            logger.info(`[BOT] ✅ Confirmação enviada para o cliente ${telefoneCLiente} - Pedido #${numeroPedido}`)
        }
    }

    // 2. Envia notificação para a loja
    if (NUMERO_LOJA) {
        const mensagemLoja = gerarMensagemPedidoRecebido(pedido)
        const enviadoLoja = await enviarMensagem(NUMERO_LOJA, mensagemLoja)

        if (enviadoLoja) {
            estatisticas.pedidosNotificados++
            logger.info(`[BOT] ✅ Notificação enviada para a loja - Pedido #${numeroPedido}`)
        }
    }

    // 3. Se for delivery, envia notificação para TODOS os entregadores ativos
    if (orderType === 'delivery' || orderType === 'entrega') {
        const entregadores = await obterEntregadores()

        if (entregadores.length === 0) {
            logger.warn('[BOT] ⚠️ Nenhum entregador ativo cadastrado no sistema')
            return
        }

        const mensagemEntregador = gerarMensagemEntregador(pedido)

        for (const entregador of entregadores) {
            if (entregador.telefone) {
                const enviado = await enviarMensagem(entregador.telefone, mensagemEntregador)

                if (enviado) {
                    logger.info(`[BOT] ✅ Notificação de delivery enviada para ${entregador.nome} (${entregador.telefone}) - Pedido #${numeroPedido}`)
                }

                // Pequeno delay entre mensagens para evitar rate limit
                await new Promise(resolve => setTimeout(resolve, 500))
            }
        }
    }
}

/**
 * Processa atualização de status do pedido
 */
async function processarAtualizacaoStatus(pedido, statusAnterior) {
    const statusNotificar = [
        'confirmed', 'confirmado',
        'preparing', 'preparando',
        'ready', 'pronto',
        'out_for_delivery', 'saiu_entrega',
        'delivered', 'entregue',
        'completed', 'finalizado'
    ]

    if (!statusNotificar.includes(pedido.status)) {
        return
    }

    // Envia atualização para a loja
    if (NUMERO_LOJA) {
        const mensagem = gerarMensagemStatusAtualizado(pedido, pedido.status)
        await enviarMensagem(NUMERO_LOJA, mensagem)
    }

    // Se o pedido estiver pronto, notifica o cliente
    const telefoneCliente = pedido.customer_phone || pedido.telefone
    if ((pedido.status === 'ready' || pedido.status === 'pronto') && telefoneCliente) {
        const mensagemCliente = gerarMensagemStatusAtualizado(pedido, pedido.status)
        await enviarMensagem(telefoneCliente, mensagemCliente)
    }
}

// Controle de polling
let ultimoPedidoProcessado = null
let intervaloPolling = null
const INTERVALO_POLLING_MS = 10000 // 10 segundos

// Controle de status da loja (sincronizado com admin)
let lojaFechadaPeloAdmin = false
let intervaloVerificacaoLoja = null
const INTERVALO_VERIFICACAO_LOJA_MS = 30000 // 30 segundos

// Controle de pedidos já processados para evitar duplicação
const pedidosProcessados = new Set()
const MAX_PEDIDOS_CACHE = 100 // Limita tamanho do cache

/**
 * Configura polling para buscar novos pedidos via Supabase
 * Usa tabela 'orders' do Rei do Churrasco
 */
async function configurarPollingPedidos() {
    // IMPORTANTE: Limpa intervalo anterior para evitar múltiplos pollings simultâneos
    if (intervaloPolling) {
        clearInterval(intervaloPolling)
        intervaloPolling = null
        logger.info('[BOT] Polling anterior limpo')
    }

    logger.info('[BOT] Configurando polling para pedidos (10s)...')

    // Carrega entregadores ativos
    await atualizarCacheEntregadores()

    // Busca o último pedido para não processar pedidos antigos
    const { data: ultimoPedido } = await supabase
        .from('orders')
        .select('id, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

    if (ultimoPedido) {
        ultimoPedidoProcessado = ultimoPedido.created_at
        logger.info(`[BOT] Último pedido: ${ultimoPedido.id} (${ultimoPedidoProcessado})`)
    } else {
        ultimoPedidoProcessado = new Date().toISOString()
    }

    // Inicia polling
    intervaloPolling = setInterval(verificarNovosPedidos, INTERVALO_POLLING_MS)
    logger.info('[BOT] ✅ Polling ativo - verificando pedidos a cada 10s')

    // Inicia verificação periódica do status da loja
    if (intervaloVerificacaoLoja) {
        clearInterval(intervaloVerificacaoLoja)
    }
    intervaloVerificacaoLoja = setInterval(verificarStatusLoja, INTERVALO_VERIFICACAO_LOJA_MS)
    await verificarStatusLoja()
    logger.info('[BOT] ✅ Verificação de status da loja ativa (30s)')
}

/**
 * Verifica se o admin fechou/abriu a loja no Supabase
 * Usa store_settings com setting_key = 'manual_status'
 */
async function verificarStatusLoja() {
    try {
        const { data, error } = await supabase
            .from('store_settings')
            .select('setting_value')
            .eq('setting_key', 'manual_status')
            .single()

        if (error) {
            logger.error('[LOJA] Erro ao verificar status:', error.message)
            return
        }

        // manual_status pode ser 'open' ou 'closed'
        const novoStatus = data?.setting_value === 'closed'

        if (novoStatus !== lojaFechadaPeloAdmin) {
            lojaFechadaPeloAdmin = novoStatus
            logger.info(`[LOJA] Status alterado: ${lojaFechadaPeloAdmin ? '🔴 FECHADA' : '🟢 ABERTA'}`)
        }
    } catch (erro) {
        logger.error('[LOJA] Erro ao verificar status:', erro.message)
    }
}

/**
 * Verifica se há novos pedidos no Supabase
 * Usa tabela 'orders' com items como JSONB (orders.items)
 */
async function verificarNovosPedidos() {
    // Se a loja está fechada pelo admin, não processa pedidos
    if (lojaFechadaPeloAdmin) {
        return
    }

    try {
        const { data: novosPedidos, error } = await supabase
            .from('orders')
            .select('*')
            .gt('created_at', ultimoPedidoProcessado)
            .order('created_at', { ascending: true })
            .limit(10)

        if (error) {
            logger.error('[POLLING] Erro ao buscar pedidos:', error.message)
            return
        }

        if (novosPedidos && novosPedidos.length > 0) {
            logger.info(`[POLLING] ${novosPedidos.length} novo(s) pedido(s) encontrado(s)`)

            for (const pedido of novosPedidos) {
                const numeroPedido = pedido.order_number || pedido.id?.slice(0, 8)
                const nomeCliente = pedido.customer_name || 'Cliente'

                // Verifica se o pedido já foi processado (evita duplicação)
                if (pedidosProcessados.has(pedido.id)) {
                    logger.info(`[POLLING] Pedido #${numeroPedido} já processado, ignorando`)
                    ultimoPedidoProcessado = pedido.created_at
                    continue
                }

                logger.info(`[POLLING] Processando pedido #${numeroPedido} - ${nomeCliente}`)
                await processarNovoPedido(pedido)

                // Marca pedido como processado
                pedidosProcessados.add(pedido.id)

                // Limpa cache se exceder limite (mantém apenas os mais recentes)
                if (pedidosProcessados.size > MAX_PEDIDOS_CACHE) {
                    const idsArray = Array.from(pedidosProcessados)
                    const idsParaRemover = idsArray.slice(0, idsArray.length - MAX_PEDIDOS_CACHE)
                    idsParaRemover.forEach(id => pedidosProcessados.delete(id))
                }

                ultimoPedidoProcessado = pedido.created_at
            }
        }
    } catch (erro) {
        logger.error('[POLLING] Erro:', erro.message)
    }
}

/**
 * Inicia conexão com WhatsApp
 */
async function iniciarConexaoWhatsApp() {
    logger.info('[BOT] Iniciando conexão com WhatsApp...')

    // Fecha socket anterior se existir
    if (sock) {
        try {
            sock.ev.removeAllListeners()
            sock.end()
        } catch (erro) {
            logger.warn('[BOT] Erro ao fechar socket anterior:', erro.message)
        }
        sock = null
    }

    const { version, isLatest } = await fetchLatestBaileysVersion()
    logger.info(`[BOT] Usando Baileys versão: ${version.join('.')}, última: ${isLatest}`)

    let state

    if (USAR_SUPABASE_AUTH) {
        logger.info('[BOT] Usando auth state do Supabase')

        // Verifica se existe sessão válida antes de iniciar
        const temSessao = await verificarSessaoExistente()
        if (temSessao) {
            logger.info('[BOT] Sessão existente encontrada no banco')
            estaAutenticado = true
        } else {
            logger.info('[BOT] Nenhuma sessão válida encontrada, será necessário escanear QR code')
            estaAutenticado = false
            contadorQrCodes = 0
        }

        const authState = await useSupabaseAuthState()
        state = authState.state
        saveCreds = authState.saveCreds
    } else {
        logger.info('[BOT] Usando auth state local (arquivo)')
        const authState = await useMultiFileAuthState('./auth_info')
        state = authState.state
        saveCreds = authState.saveCreds
    }

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        browser: Browsers.ubuntu('Chrome'),
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 30000,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 15000,
        qrTimeout: 20000,
        getMessage: async () => undefined,
        retryRequestDelayMs: 100
    })

    // Evento de atualização de conexão
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            contadorQrCodes++
            qrCodeAtual = qr
            statusConexao = 'aguardando_qr'
            logger.info(`[BOT] QR Code #${contadorQrCodes} gerado - escaneie com o WhatsApp`)
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode

            // Verifica se é conexão inicial (não autenticada e sem QR gerado ainda)
            const eConexaoInicial = !estaAutenticado && contadorQrCodes === 0

            // Verifica se deve reconectar baseado no código de status
            const foiLogout = statusCode === DisconnectReason.loggedOut
            const foiDesconexaoTemporaria = statusCode === DisconnectReason.connectionClosed ||
                statusCode === DisconnectReason.connectionLost ||
                statusCode === DisconnectReason.connectionReplaced ||
                statusCode === DisconnectReason.timedOut ||
                statusCode === DisconnectReason.restartRequired

            statusConexao = 'desconectado'
            qrCodeAtual = null
            numeroConectado = null
            nomePerfil = null
            conectadoEm = null

            logger.info(`[BOT] Conexão fechada. StatusCode: ${statusCode}, Autenticado: ${estaAutenticado}, QRs: ${contadorQrCodes}`)

            // Se é conexão inicial, aguarda para permitir geração de QR
            if (eConexaoInicial) {
                logger.info('[BOT] Conexão inicial fechada, aguardando geração de QR code...')
                return
            }

            // Se foi logout, limpa sessão e reinicia
            if (foiLogout) {
                logger.info('[BOT] Logout detectado, limpando sessão...')
                estaAutenticado = false
                contadorQrCodes = 0
                tentativasReconexao = 0
                if (USAR_SUPABASE_AUTH) {
                    await limparSessao()
                }
                setTimeout(iniciarConexaoWhatsApp, 2000)
                return
            }

            // Se estava autenticado ou teve desconexão temporária, tenta reconectar
            if (estaAutenticado || foiDesconexaoTemporaria) {
                tentativasReconexao++

                if (tentativasReconexao > MAX_TENTATIVAS_RECONEXAO) {
                    logger.error(`[BOT] Máximo de ${MAX_TENTATIVAS_RECONEXAO} tentativas de reconexão atingido. Reiniciando contador...`)
                    tentativasReconexao = 0
                    contadorQrCodes = 0
                }

                // Backoff exponencial: 3s, 6s, 12s, 24s, 48s
                const delayReconexao = DELAY_BASE_RECONEXAO_MS * Math.pow(2, tentativasReconexao - 1)
                logger.info(`[BOT] Reconectando em ${delayReconexao / 1000}s (tentativa ${tentativasReconexao}/${MAX_TENTATIVAS_RECONEXAO})...`)
                setTimeout(iniciarConexaoWhatsApp, delayReconexao)
                return
            }

            // Se chegou aqui e tem QR codes gerados, aguarda usuário escanear
            if (contadorQrCodes > 0) {
                logger.info('[BOT] Aguardando usuário escanear QR code...')
                return
            }

            // Caso não coberto, tenta reconectar após delay
            logger.info('[BOT] Reconectando em 5 segundos...')
            setTimeout(iniciarConexaoWhatsApp, 5000)
        }

        if (connection === 'open') {
            statusConexao = 'conectado'
            qrCodeAtual = null
            conectadoEm = new Date().toISOString()
            estaAutenticado = true
            tentativasReconexao = 0

            const user = sock.user
            if (user) {
                numeroConectado = user.id.split(':')[0]
                nomePerfil = user.name || 'Rei do Churrasco Bot'
            }

            logger.info(`[BOT] ✅ Conectado como ${nomePerfil} (${numeroConectado})`)

            // Configura polling de pedidos
            await configurarPollingPedidos()
        }
    })

    // Salva credenciais quando atualizadas
    sock.ev.on('creds.update', async () => {
        if (saveCreds) {
            await saveCreds()
        }
    })

    // Processa mensagens recebidas e envia respostas automáticas
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Ignora mensagens de sincronização de histórico
        if (type !== 'notify') return

        for (const mensagem of messages) {
            estatisticas.mensagensRecebidas++

            // Ignora mensagens enviadas pelo próprio bot
            if (mensagem.key.fromMe) continue

            // Ignora mensagens de grupo
            if (mensagem.key.remoteJid?.endsWith('@g.us')) continue

            // Ignora mensagens de status/broadcast
            if (mensagem.key.remoteJid === 'status@broadcast') continue

            // Obtém o texto da mensagem
            const textoMensagem = mensagem.message?.conversation ||
                mensagem.message?.extendedTextMessage?.text ||
                mensagem.message?.imageMessage?.caption ||
                mensagem.message?.videoMessage?.caption ||
                ''

            if (!textoMensagem.trim()) continue

            // Obtém número do remetente
            const numeroRemetente = mensagem.key.remoteJid?.replace('@s.whatsapp.net', '') || ''

            logger.info(`[BOT] Mensagem recebida de ${numeroRemetente}: ${textoMensagem.substring(0, 50)}...`)

            try {
                // Processa a mensagem e obtém resposta automática
                const resposta = await processarMensagemRecebida(textoMensagem, numeroRemetente)

                if (resposta) {
                    // Suporte a múltiplas mensagens (array) - ex: PIX envia chave separada para copiar
                    const mensagens = Array.isArray(resposta) ? resposta : [resposta]

                    for (const msg of mensagens) {
                        await sock.sendMessage(mensagem.key.remoteJid, { text: msg })
                        estatisticas.mensagensEnviadas++

                        // Pequeno delay entre mensagens múltiplas
                        if (mensagens.length > 1) {
                            await new Promise(resolve => setTimeout(resolve, 500))
                        }
                    }

                    logger.info(`[BOT] Resposta automática enviada para ${numeroRemetente}`)
                }
            } catch (erro) {
                logger.error(`[BOT] Erro ao processar mensagem: ${erro.message}`)
            }
        }
    })
}

// =============== API EXPRESS ===============

const app = express()
app.use(cors())
app.use(express.json())

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot: 'Rei do Churrasco WhatsApp Bot',
        versao: '1.0.0'
    })
})

// Status da conexão
app.get('/status', async (req, res) => {
    const entregadores = await obterEntregadores()

    res.json({
        sucesso: true,
        dados: {
            conectado: statusConexao === 'conectado',
            status: statusConexao,
            numeroConectado: numeroConectado,
            nomePerfil: nomePerfil,
            conectadoEm: conectadoEm,
            qrDisponivel: !!qrCodeAtual,
            lojaFechada: lojaFechadaPeloAdmin,
            estadoReconexao: {
                autenticado: estaAutenticado,
                qrCodesGerados: contadorQrCodes,
                tentativasReconexao: tentativasReconexao
            },
            estatisticas: {
                mensagensRecebidas: estatisticas.mensagensRecebidas,
                mensagensEnviadas: estatisticas.mensagensEnviadas,
                pedidosNotificados: estatisticas.pedidosNotificados
            }
        },
        entregadoresAtivos: entregadores.length,
        entregadores: entregadores.map(e => ({ nome: e.nome, telefone: e.telefone }))
    })
})

// Retorna QR code
app.get('/qr', (req, res) => {
    if (statusConexao === 'conectado') {
        res.json({ sucesso: true, status: 'conectado', message: 'Bot já está conectado' })
    } else if (qrCodeAtual) {
        res.json({ sucesso: true, status: 'aguardando_qr', qrCode: qrCodeAtual })
    } else {
        res.json({ sucesso: false, status: statusConexao, message: 'QR code não disponível' })
    }
})

// Reconectar - reinicia a conexão
app.post('/reconectar', async (req, res) => {
    try {
        if (sock) {
            sock.end()
        }
        setTimeout(() => {
            iniciarConexaoWhatsApp()
        }, 1000)
        res.json({ sucesso: true, message: 'Reconectando...' })
    } catch (erro) {
        res.json({ sucesso: false, erro: erro.message })
    }
})

// Limpar sessão - remove credenciais e força novo pareamento
app.post('/limpar-sessao', async (req, res) => {
    try {
        if (sock) {
            try {
                await sock.logout()
            } catch (logoutErro) {
                logger.warn('[API] Erro no logout:', logoutErro.message)
            }
        }
        if (USAR_SUPABASE_AUTH) {
            await limparSessao()
        }

        // Reseta todas as variáveis de estado
        qrCodeAtual = null
        statusConexao = 'desconectado'
        numeroConectado = null
        nomePerfil = null
        conectadoEm = null
        estaAutenticado = false
        contadorQrCodes = 0
        tentativasReconexao = 0

        setTimeout(() => {
            iniciarConexaoWhatsApp()
        }, 2000)

        res.json({ sucesso: true, message: 'Sessão limpa, novo QR code será gerado' })
    } catch (erro) {
        res.json({ sucesso: false, erro: erro.message })
    }
})

// Força atualização do cache de entregadores
app.post('/atualizar-entregadores', async (req, res) => {
    await atualizarCacheEntregadores()
    res.json({
        success: true,
        entregadores: cacheEntregadores.map(e => ({ nome: e.nome, telefone: e.telefone }))
    })
})

// Endpoint para enviar mensagem manualmente
app.post('/enviar', async (req, res) => {
    const { telefone, mensagem } = req.body

    if (!telefone || !mensagem) {
        return res.status(400).json({ error: 'Telefone e mensagem são obrigatórios' })
    }

    const enviado = await enviarMensagem(telefone, mensagem)
    res.json({ success: enviado })
})

// Desconectar
app.post('/desconectar', async (req, res) => {
    try {
        if (sock) {
            sock.end()
            statusConexao = 'desconectado'
            numeroConectado = null
            nomePerfil = null
        }
        res.json({ sucesso: true, message: 'Desconectado' })
    } catch (erro) {
        res.json({ sucesso: false, erro: erro.message })
    }
})

// Inicia servidor
app.listen(PORTA, () => {
    logger.info(`[API] Servidor rodando na porta ${PORTA}`)
    logger.info(`[API] Endpoints disponíveis:`)
    logger.info(`[API]   GET  /        - Health check`)
    logger.info(`[API]   GET  /status  - Status da conexão`)
    logger.info(`[API]   GET  /qr      - QR Code para conexão`)
    logger.info(`[API]   POST /enviar  - Enviar mensagem`)
    logger.info(`[API]   POST /atualizar-entregadores - Atualiza cache`)
    logger.info(`[API]   POST /desconectar - Desconecta o bot`)

    // Inicia conexão WhatsApp
    iniciarConexaoWhatsApp()
})

// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('[BOT] Encerrando...')
    if (intervaloPolling) clearInterval(intervaloPolling)
    if (intervaloVerificacaoLoja) clearInterval(intervaloVerificacaoLoja)
    process.exit(0)
})

process.on('SIGTERM', () => {
    logger.info('[BOT] Encerrando (SIGTERM)...')
    if (intervaloPolling) clearInterval(intervaloPolling)
    if (intervaloVerificacaoLoja) clearInterval(intervaloVerificacaoLoja)
    process.exit(0)
})
