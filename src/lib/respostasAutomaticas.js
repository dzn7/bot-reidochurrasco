/**
 * Respostas Automáticas - Rei do Churrasco WhatsApp Bot
 * 
 * Responde APENAS a palavras-chave específicas sobre produtos.
 * Horário de funcionamento: Seg-Qui 17:00-23:00, Sex-Sáb 17:00-00:00, Dom fechado.
 * Sempre inclui o link do site.
 * 
 * Inclui mensagens temáticas para datas especiais:
 * - Carnaval, Natal, Ano Novo, São João, Dia das Mães, Dia dos Pais,
 *   Dia dos Namorados, Dia das Crianças
 * 
 * Sistema inteligente de PIX: alterna entre duas chaves automaticamente
 * sem enviar ambas de uma vez.
 * 
 * Timezone: America/Fortaleza (UTC-3)
 */

import { supabase } from './supabase.js'
import { selecionarChavePixInteligente } from './pix.js'

const LINK_SITE = 'https://reidochurrascobarras.com.br'
const NOME_LOJA = 'Rei do Churrasco'

// Timezone para cálculos de data/hora
const TIMEZONE = 'America/Fortaleza'

// Cache de configurações
let configuracoesLoja = null
let ultimaAtualizacaoConfig = null
const INTERVALO_CACHE_CONFIG_MS = 5 * 60 * 1000

// Anti-spam: 2 minutos entre respostas por número
const ultimasRespostas = new Map()
const INTERVALO_MINIMO_RESPOSTA_MS = 2 * 60 * 1000

/**
 * Obtém data/hora atual no timezone America/Fortaleza
 */
function obterDataHoraAtual() {
    const agora = new Date()

    // Usa Intl.DateTimeFormat para extrair componentes no timezone correto
    const formatador = new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        weekday: 'long'
    })

    const partes = formatador.formatToParts(agora)
    const obterParte = (tipo) => parseInt(partes.find(p => p.type === tipo)?.value || '0', 10)
    const obterTexto = (tipo) => partes.find(p => p.type === tipo)?.value || ''

    return {
        ano: obterParte('year'),
        mes: obterParte('month'),
        dia: obterParte('day'),
        hora: obterParte('hour'),
        minutos: obterParte('minute'),
        totalMinutos: obterParte('hour') * 60 + obterParte('minute'),
        diaSemana: obterTexto('weekday')
    }
}

/**
 * Retorna se a loja está no horário de funcionamento
 * Seg-Qui: 17:00-23:00 | Sex-Sáb: 17:00-00:00 | Dom: fechado
 */
function estaNoHorario() {
    const { totalMinutos, diaSemana } = obterDataHoraAtual()
    const diaNormalizado = diaSemana.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    // Domingo: fechado
    if (diaNormalizado.includes('domingo')) {
        return false
    }

    const ABERTURA = 17 * 60 // 17:00

    // Sexta e sábado: 17:00 até 00:00 (meia-noite)
    if (diaNormalizado.includes('sexta') || diaNormalizado.includes('sabado')) {
        // Após 17:00 até meia-noite
        return totalMinutos >= ABERTURA
    }

    // Seg-Qui: 17:00 até 23:00
    const FECHAMENTO = 23 * 60 // 23:00
    return totalMinutos >= ABERTURA && totalMinutos < FECHAMENTO
}

/**
 * Saudação baseada no horário
 */
function obterSaudacao() {
    const { hora } = obterDataHoraAtual()
    if (hora >= 5 && hora < 12) return 'Bom dia'
    if (hora >= 12 && hora < 18) return 'Boa tarde'
    return 'Boa noite'
}

/**
 * Retorna o dia da semana formatado para exibição
 */
function obterDiaSemanaFormatado() {
    const { diaSemana } = obterDataHoraAtual()
    return diaSemana.charAt(0).toUpperCase() + diaSemana.slice(1)
}

// ==========================================
// DATAS ESPECIAIS
// ==========================================

/**
 * Calcula a data da Páscoa para um dado ano (algoritmo de Gauss)
 * Retorna { mes, dia }
 */
function calcularPascoa(ano) {
    const a = ano % 19
    const b = Math.floor(ano / 100)
    const c = ano % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const mes = Math.floor((h + l - 7 * m + 114) / 31)
    const dia = ((h + l - 7 * m + 114) % 31) + 1
    return { mes, dia }
}

/**
 * Retorna a data do Carnaval (terça-feira de Carnaval = Páscoa - 47 dias)
 * O período de Carnaval inclui sábado a terça (5 dias: -4 a 0)
 */
function obterPeriodoCarnaval(ano) {
    const pascoa = calcularPascoa(ano)
    const dataPascoa = new Date(ano, pascoa.mes - 1, pascoa.dia)
    const tercaCarnaval = new Date(dataPascoa)
    tercaCarnaval.setDate(dataPascoa.getDate() - 47)

    // Período: sábado antes até terça de carnaval (4 dias antes até o dia)
    const inicio = new Date(tercaCarnaval)
    inicio.setDate(tercaCarnaval.getDate() - 3) // sábado
    const fim = new Date(tercaCarnaval) // terça

    return { inicio, fim }
}

/**
 * Calcula o N-ésimo domingo de um mês
 */
function obterNesimoDomingo(ano, mes, n) {
    const data = new Date(ano, mes - 1, 1)
    let contadorDomingos = 0

    while (contadorDomingos < n) {
        if (data.getDay() === 0) {
            contadorDomingos++
            if (contadorDomingos === n) break
        }
        data.setDate(data.getDate() + 1)
    }

    return { mes, dia: data.getDate() }
}

/**
 * Verifica se uma data está dentro de um período (inclusive)
 */
function estaEntreDatas(dataAtual, inicio, fim) {
    const atual = new Date(dataAtual.ano, dataAtual.mes - 1, dataAtual.dia)
    return atual >= inicio && atual <= fim
}

/**
 * Verifica se estamos em uma data especial e retorna a mensagem correspondente
 */
function obterMensagemDataEspecial() {
    const { ano, mes, dia } = obterDataHoraAtual()

    // 1. CARNAVAL (dinâmico, baseado na Páscoa)
    const periodoCarnaval = obterPeriodoCarnaval(ano)
    if (estaEntreDatas({ ano, mes, dia }, periodoCarnaval.inicio, periodoCarnaval.fim)) {
        return `🎉🥩 Seja bem-vindo ao ${NOME_LOJA}! 🥩🎉

O Carnaval chegou com muito sabor, alegria e aquele churrasco que faz a gente sambar de felicidade! 🥳🔥

Não fique de fora dessa folia de sabores!
Faça seu pedido agora mesmo: 👉 ${LINK_SITE}

💛 ${NOME_LOJA} — O melhor churrasco no ritmo do Carnaval! 💚`
    }

    // 2. NATAL (20 a 26 de dezembro)
    if (mes === 12 && dia >= 20 && dia <= 26) {
        return `🎄🥩 Feliz Natal! 🥩🎄

O *${NOME_LOJA}* deseja a você e toda sua família um Natal repleto de paz, amor e muito sabor! 🎅❤️

Neste Natal, celebre com nosso churrasco especial! 🎁🔥

Faça seu pedido: 👉 ${LINK_SITE}

🌟 ${NOME_LOJA} — O melhor presente é um churrasco de verdade! 🌟`
    }

    // 3. ANO NOVO (28 de dezembro a 2 de janeiro)
    if ((mes === 12 && dia >= 28) || (mes === 1 && dia <= 2)) {
        const anoNovo = mes === 12 ? ano + 1 : ano
        return `🎆🥩 Feliz Ano Novo! 🥩🎆

O *${NOME_LOJA}* deseja um ${anoNovo} repleto de conquistas, felicidade e churrascos incríveis! 🥂✨

Comece o ano com o melhor sabor!
Faça seu pedido: 👉 ${LINK_SITE}

🎉 ${NOME_LOJA} — Um novo ano, o mesmo sabor inconfundível! 🎉`
    }

    // 4. DIA DOS NAMORADOS (12 de junho - Brasil)
    if (mes === 6 && dia === 12) {
        return `💕🥩 Feliz Dia dos Namorados! 🥩💕

No *${NOME_LOJA}*, acreditamos que o amor combina com um churrasco incrível! 💑🔥

Surpreenda quem você ama com nossos pratos especiais! 🥰

Peça agora: 👉 ${LINK_SITE}

❤️ ${NOME_LOJA} — O amor também passa pelo estômago! ❤️`
    }

    // 5. DIA DAS MÃES (2º domingo de maio)
    const diaDasMaes = obterNesimoDomingo(ano, 5, 2)
    if (mes === 5 && dia === diaDasMaes.dia) {
        return `👩‍👧‍👦🥩 Feliz Dia das Mães! 🥩👩‍👧‍👦

O *${NOME_LOJA}* parabeniza todas as mães! Vocês são incríveis! 💐❤️

Que tal celebrar com um churrasco especial pra ela? 🎉🔥

Peça agora: 👉 ${LINK_SITE}

💖 ${NOME_LOJA} — Mãe merece o melhor sabor! 💖`
    }

    // 6. DIA DOS PAIS (2º domingo de agosto)
    const diaDoPais = obterNesimoDomingo(ano, 8, 2)
    if (mes === 8 && dia === diaDoPais.dia) {
        return `👨‍👧‍👦🥩 Feliz Dia dos Pais! 🥩👨‍👧‍👦

O *${NOME_LOJA}* homenageia todos os pais! Vocês são demais! 💪❤️

Celebre com aquele churrasco que seu pai merece! 🎉🔥

Peça agora: 👉 ${LINK_SITE}

🏆 ${NOME_LOJA} — Pai também merece o melhor churrasco! 🏆`
    }

    // 7. SÃO JOÃO (22 a 25 de junho)
    if (mes === 6 && dia >= 22 && dia <= 25) {
        return `🎇🥩 Viva São João! 🥩🎇

O *${NOME_LOJA}* entra no clima das festas juninas com muito sabor e animação! 🌽🔥

Além do forró, garanta aquele churrasco que combina com tudo!

Faça seu pedido: 👉 ${LINK_SITE}

🎶 ${NOME_LOJA} — Arraiá de sabores na brasa! 🎶`
    }

    // 8. DIA DAS CRIANÇAS (12 de outubro)
    if (mes === 10 && dia === 12) {
        return `🧒🥩 Feliz Dia das Crianças! 🥩🧒

O *${NOME_LOJA}* deseja um dia cheio de alegria e diversão para a criançada! 🎈🎉

O melhor presente? Um churrasco delicioso em família! 🤩🔥

Peça agora: 👉 ${LINK_SITE}

🎁 ${NOME_LOJA} — Sabor que faz qualquer criança sorrir! 🎁`
    }

    // Sem data especial
    return null
}

// ==========================================
// LÓGICA PRINCIPAL
// ==========================================

/**
 * Carrega configurações da loja (com cache)
 * Usa store_settings ao invés de configuracoes_loja
 */
async function carregarConfiguracoesLoja() {
    const agora = Date.now()

    if (configuracoesLoja && ultimaAtualizacaoConfig && (agora - ultimaAtualizacaoConfig) < INTERVALO_CACHE_CONFIG_MS) {
        return configuracoesLoja
    }

    try {
        const { data, error } = await supabase
            .from('store_settings')
            .select('setting_key, setting_value')

        if (error) {
            console.error('[RESPOSTAS] Erro ao carregar configurações:', error.message)
            return configuracoesLoja || {}
        }

        configuracoesLoja = {}
        for (const item of data || []) {
            configuracoesLoja[item.setting_key] = item.setting_value
        }

        ultimaAtualizacaoConfig = agora
        return configuracoesLoja
    } catch (erro) {
        console.error('[RESPOSTAS] Erro ao carregar configurações:', erro.message)
        return configuracoesLoja || {}
    }
}

/**
 * Anti-spam: verifica se pode responder (2 min entre respostas)
 */
function podeResponder(numeroRemetente) {
    const agora = Date.now()
    const ultimaResposta = ultimasRespostas.get(numeroRemetente)

    if (ultimaResposta && (agora - ultimaResposta) < INTERVALO_MINIMO_RESPOSTA_MS) {
        return false
    }

    return true
}

/**
 * Registra que uma resposta foi enviada (só chamar quando de fato responder)
 */
function registrarResposta(numeroRemetente) {
    const agora = Date.now()
    ultimasRespostas.set(numeroRemetente, agora)

    // Limpa entradas com mais de 1 hora
    for (const [numero, tempo] of ultimasRespostas.entries()) {
        if (agora - tempo > 60 * 60 * 1000) {
            ultimasRespostas.delete(numero)
        }
    }
}

/**
 * Normaliza texto removendo acentos, pontuação e convertendo para minúsculo
 */
function normalizarTexto(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, '')
        .trim()
}

/**
 * Detecta intenção da mensagem.
 * Retorna 'saudacao', 'churrasco', 'pix', 'horario', 'pedido', 'entrega', 'marmita', 'localizacao' ou null.
 */
function detectarIntencao(mensagem) {
    const texto = normalizarTexto(mensagem)

    const termosSaudacao = [
        'boa noite', 'boa tarde', 'bom dia', 'boa madrugada',
        'oi', 'ola', 'hey', 'eae', 'e ai', 'fala',
        'salve', 'hello', 'hi', 'oie', 'oii', 'oiii',
        'boa', 'bao', 'blz', 'beleza', 'tudo bem',
        'tudo bom', 'como vai', 'opa', 'opaa'
    ]

    const termosPix = [
        'pix', 'chave pix', 'chave do pix', 'qual o pix', 'qual pix',
        'manda o pix', 'manda pix', 'envia o pix', 'envia pix',
        'passa o pix', 'passa pix', 'me passa o pix',
        'forma de pagamento', 'formas de pagamento', 'como pagar',
        'como pago', 'como faco pra pagar', 'como eu pago',
        'pagamento', 'transferencia', 'transferir'
    ]

    const termosHorario = [
        'horario', 'horarios', 'que horas abre', 'que horas fecha',
        'ta aberto', 'esta aberto', 'aberto', 'fechado',
        'que horas', 'funciona ate', 'abre que horas',
        'hora de funcionar', 'funcionamento'
    ]

    const termosPedido = [
        'quero pedir', 'quero fazer pedido', 'fazer pedido',
        'como faco pedido', 'como pedir', 'como faz pra pedir',
        'aceita pedido', 'pedido', 'menu', 'site'
    ]

    const termosEntrega = [
        'entrega', 'delivery', 'entregam', 'taxa de entrega',
        'taxa entrega', 'frete', 'entregam aqui', 'entrega no',
        'voces entregam', 'faz entrega'
    ]

    const termosChurrasco = [
        'churrasco', 'carne', 'picanha', 'costela', 'maminha',
        'carneiro', 'suino', 'frango', 'linguica', 'toscana',
        'mignon', 'file', 'contra file', 'pernil', 'carre',
        'tira gosto', 'tiragosto', 'porcao', 'porcoes',
        'cardapio', 'tem carne', 'quero carne',
        'vende carne', 'quero churrasco', 'tem churrasco',
        'bebida', 'cerveja', 'heineken', 'budweiser', 'skol',
        'whisky', 'vodka', 'gin', 'dose', 'suco'
    ]

    const termosMarmita = [
        'marmita', 'marmitex', 'quentinha', 'viagem',
        'pra levar', 'embalagem', 'quero marmita', 'tem marmita'
    ]

    const termosLocalizacao = [
        'endereco', 'onde fica', 'localizacao', 'como chegar',
        'onde voces ficam', 'onde e', 'qual o endereco', 'mapa',
        'rua', 'local', 'onde fica a loja'
    ]

    if (termosPix.some(t => texto.includes(t))) {
        return 'pix'
    }

    if (termosHorario.some(t => texto.includes(t))) {
        return 'horario'
    }

    if (termosPedido.some(t => texto.includes(t))) {
        return 'pedido'
    }

    if (termosEntrega.some(t => texto.includes(t))) {
        return 'entrega'
    }

    if (termosMarmita.some(t => texto.includes(t))) {
        return 'marmita'
    }

    if (termosLocalizacao.some(t => texto.includes(t))) {
        return 'localizacao'
    }

    if (termosChurrasco.some(t => texto.includes(t))) {
        return 'churrasco'
    }

    // Saudação por último (palavras mais genéricas)
    if (termosSaudacao.some(t => texto === t || texto.startsWith(t + ' ') || texto.endsWith(' ' + t))) {
        return 'saudacao'
    }

    return null
}

/**
 * Verifica se a loja está aberta consultando store_settings no Supabase
 * A chave 'manual_status' é controlada pelo admin
 */
async function verificarLojaAbertaSupabase() {
    try {
        const config = await carregarConfiguracoesLoja()

        // Se o admin fechou a loja manualmente, respeita
        if (config.manual_status === 'closed') {
            return false
        }

        // Se o admin abriu manualmente, respeita
        if (config.manual_status === 'open') {
            return true
        }

        // Fallback: usa o horário normal
        return estaNoHorario()
    } catch (erro) {
        // Em caso de erro, usa o horário como fallback
        return estaNoHorario()
    }
}

/**
 * Gera resposta de saudação com link do site
 * Inclui mensagem temática se for data especial
 */
async function gerarRespostaSaudacao() {
    // Verifica se há mensagem de data especial
    const mensagemEspecial = obterMensagemDataEspecial()
    if (mensagemEspecial) {
        return mensagemEspecial
    }

    const saudacao = obterSaudacao()
    const lojaAberta = await verificarLojaAbertaSupabase()

    if (!lojaAberta) {
        return `${saudacao}! 👋

Obrigado por entrar em contato com *${NOME_LOJA}* 🔥🥩

No momento estamos *fechados*, mas você pode conferir nosso cardápio completo:
${LINK_SITE}

Voltamos em breve! 😉`
    }

    return `${saudacao}! 👋

Obrigado por entrar em contato com *${NOME_LOJA}* 🔥🥩

Estamos abertos! Confira nosso cardápio e faça seu pedido:
${LINK_SITE}

O melhor churrasco da região! 🔥`
}

/**
 * Gera resposta com dados do PIX
 * Alterna inteligentemente entre as duas chaves
 */
function gerarRespostaPix(numeroRemetente) {
    const saudacao = obterSaudacao()
    const pixSelecionado = selecionarChavePixInteligente(numeroRemetente)

    // Retorna array: primeira msg com info, segunda msg só com a chave para facilitar cópia
    return [
        `${saudacao}! 💰

Segue nossa chave *PIX* para pagamento:

*Tipo:* ${pixSelecionado.tipo}
*Titular:* ${pixSelecionado.titular}

A chave está na próxima mensagem, é só copiar! 👇`,
        pixSelecionado.chave
    ]
}

/**
 * Gera resposta sobre horário de funcionamento
 */
async function gerarRespostaHorario() {
    const saudacao = obterSaudacao()
    const lojaAberta = await verificarLojaAbertaSupabase()

    const statusAtual = lojaAberta ? '✅ *Estamos abertos agora!*' : '🔴 *Estamos fechados no momento*'

    return `${saudacao}! ⏰

${statusAtual}

*Nosso horário:*
🔥 *Seg a Qui:* 17:00 às 23:00
🔥 *Sexta e Sábado:* 17:00 às 00:00
❌ *Domingo:* Fechado

Confira o cardápio:
${LINK_SITE}`
}

/**
 * Gera resposta sobre como fazer pedido
 */
async function gerarRespostaPedido() {
    const saudacao = obterSaudacao()
    const lojaAberta = await verificarLojaAbertaSupabase()

    if (!lojaAberta) {
        return `${saudacao}! 📋

No momento estamos *fechados*, mas quando abrirmos você pode pedir direto pelo site:
${LINK_SITE}

É rápido e fácil! 😉`
    }

    return `${saudacao}! 📋

Para fazer seu pedido é muito simples! Acesse nosso site:
${LINK_SITE}

Lá você encontra todo o cardápio, escolhe os itens e finaliza o pedido! 🥩🔥

Aceitamos *PIX, cartão e dinheiro*! 💰`
}

/**
 * Gera resposta sobre entregas
 */
function gerarRespostaEntrega() {
    const saudacao = obterSaudacao()

    return `${saudacao}! 🛵

Sim, fazemos *delivery*! A taxa de entrega varia conforme o bairro.

Acesse nosso site para ver os bairros atendidos e fazer seu pedido:
${LINK_SITE}

Também temos *retirada no balcão* e *consumo no local*! 🥩🔥`
}

/**
 * Gera resposta sobre churrasco/carnes (curta e direta)
 */
function gerarRespostaChurrasco(aberto) {
    const saudacao = obterSaudacao()

    if (aberto) {
        return `${saudacao}! 🔥🥩

Temos o melhor *churrasco* da região! Estamos abertos 🔥

Picanha, costela, maminha, carneiro, tira gostos, porções e muito mais!

Veja o cardápio e peça pelo site:
${LINK_SITE}`
    }

    return `${saudacao}! 🔥🥩

Temos o melhor *churrasco* da região! Mas estamos fechados no momento.

Confira nosso cardápio:
${LINK_SITE}`
}

/**
 * Gera resposta sobre marmitas
 */
function gerarRespostaMarmita(aberto) {
    const saudacao = obterSaudacao()

    if (aberto) {
        return `${saudacao}! 🍱

Sim, temos *marmitas/quentinhas*! Estamos abertos 🔥

Confira nossas opções e faça seu pedido:
${LINK_SITE}

Marmita completa com o melhor churrasco! 🥩`
    }

    return `${saudacao}! 🍱

Sim, temos *marmitas/quentinhas*! Mas estamos fechados no momento.

Confira nosso cardápio:
${LINK_SITE}`
}

/**
 * Gera resposta sobre localização
 */
function gerarRespostaLocalizacao() {
    const saudacao = obterSaudacao()

    return `${saudacao}! 📍

O *${NOME_LOJA}* fica na:
*R. Gen. Taumaturgo de Azevedo, n° 279 - Riachinho*

📞 Contato: *(86) 98131-9596*

Confira nosso cardápio:
${LINK_SITE}

Esperamos você! 🔥🥩`
}

/**
 * Processa mensagem recebida e retorna resposta para palavras-chave reconhecidas.
 * Retorna null para qualquer outra mensagem (não responde).
 */
export async function processarMensagemRecebida(mensagem, numeroRemetente) {
    const intencao = detectarIntencao(mensagem)

    // Só responde se a mensagem tiver uma intenção reconhecida
    if (!intencao) {
        return null
    }

    // Anti-spam: verifica DEPOIS de detectar intenção (não bloqueia por msgs sem keyword)
    // PIX nunca é bloqueado — é informação crítica para pagamento
    if (intencao !== 'pix' && !podeResponder(numeroRemetente)) {
        console.log(`[RESPOSTAS] Anti-spam: ignorando ${numeroRemetente}`)
        return null
    }

    // Registra resposta APENAS quando vai de fato responder
    registrarResposta(numeroRemetente)

    const aberto = estaNoHorario()
    console.log(`[RESPOSTAS] Intenção: ${intencao} | Aberto: ${aberto} | De: ${numeroRemetente}`)

    switch (intencao) {
        case 'saudacao':
            return await gerarRespostaSaudacao()
        case 'pix':
            return gerarRespostaPix(numeroRemetente)
        case 'horario':
            return await gerarRespostaHorario()
        case 'pedido':
            return await gerarRespostaPedido()
        case 'entrega':
            return gerarRespostaEntrega()
        case 'churrasco':
            return gerarRespostaChurrasco(aberto)
        case 'marmita':
            return gerarRespostaMarmita(aberto)
        case 'localizacao':
            return gerarRespostaLocalizacao()
        default:
            return null
    }
}

export function resetarAntiSpam(numero) {
    if (numero) {
        ultimasRespostas.delete(numero)
    } else {
        ultimasRespostas.clear()
    }
}

export async function atualizarConfiguracoes() {
    ultimaAtualizacaoConfig = null
    return await carregarConfiguracoesLoja()
}

export function verificarLojaAberta() {
    return estaNoHorario()
}

export default {
    processarMensagemRecebida,
    resetarAntiSpam,
    atualizarConfiguracoes,
    obterSaudacao,
    verificarLojaAberta
}
