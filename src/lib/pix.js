/**
 * Utilitários de PIX do bot
 * - Seleção aleatória inteligente entre chaves
 * - Evita repetir a mesma chave em sequência para o mesmo número
 * - Balanceia o uso entre as chaves disponíveis
 */

const CHAVES_PIX = [
    {
        tipo: 'Aleatória',
        chave: '74849085-bf79-49ce-9897-95ccee2a3004',
        titular: 'Rei do Churrasco'
    },
    {
        tipo: 'E-mail',
        chave: 'Marcos.f.alves1984@gmail.com',
        titular: 'Rei do Churrasco'
    }
]

const ultimoEnvioPorNumero = new Map()
const usoPorIndice = new Map(CHAVES_PIX.map((_, indice) => [indice, 0]))

const INTERVALO_BLOQUEIO_REPETICAO_MS = 6 * 60 * 60 * 1000
const RETENCAO_HISTORICO_MS = 24 * 60 * 60 * 1000
const LIMITE_HISTORICO = 2000

function normalizarNumero(numero) {
    return String(numero || '').replace(/\D/g, '')
}

function limparHistoricoAntigo() {
    const agora = Date.now()

    for (const [numero, info] of ultimoEnvioPorNumero.entries()) {
        if (!info?.timestamp || (agora - info.timestamp) > RETENCAO_HISTORICO_MS) {
            ultimoEnvioPorNumero.delete(numero)
        }
    }

    if (ultimoEnvioPorNumero.size <= LIMITE_HISTORICO) return

    const entradasOrdenadas = [...ultimoEnvioPorNumero.entries()]
        .sort((a, b) => (a[1]?.timestamp || 0) - (b[1]?.timestamp || 0))

    const excedente = ultimoEnvioPorNumero.size - LIMITE_HISTORICO
    for (let i = 0; i < excedente; i++) {
        ultimoEnvioPorNumero.delete(entradasOrdenadas[i][0])
    }
}

export function obterChavesPix() {
    return CHAVES_PIX.map((chave) => ({ ...chave }))
}

export function selecionarChavePixInteligente(numeroRemetente) {
    limparHistoricoAntigo()

    const numeroNormalizado = normalizarNumero(numeroRemetente)
    const ultimoEnvio = numeroNormalizado ? ultimoEnvioPorNumero.get(numeroNormalizado) : null
    const agora = Date.now()

    let indicesCandidatos = CHAVES_PIX.map((_, indice) => indice)

    if (
        CHAVES_PIX.length > 1 &&
        ultimoEnvio &&
        typeof ultimoEnvio.indice === 'number' &&
        (agora - ultimoEnvio.timestamp) < INTERVALO_BLOQUEIO_REPETICAO_MS
    ) {
        indicesCandidatos = indicesCandidatos.filter((indice) => indice !== ultimoEnvio.indice)
    }

    if (indicesCandidatos.length === 0) {
        indicesCandidatos = CHAVES_PIX.map((_, indice) => indice)
    }

    const menorUso = Math.min(...indicesCandidatos.map((indice) => usoPorIndice.get(indice) || 0))
    const indicesBalanceados = indicesCandidatos.filter((indice) => (usoPorIndice.get(indice) || 0) === menorUso)
    const grupoSorteio = indicesBalanceados.length > 0 ? indicesBalanceados : indicesCandidatos
    const indiceSorteado = grupoSorteio[Math.floor(Math.random() * grupoSorteio.length)]

    usoPorIndice.set(indiceSorteado, (usoPorIndice.get(indiceSorteado) || 0) + 1)

    if (numeroNormalizado) {
        ultimoEnvioPorNumero.set(numeroNormalizado, {
            indice: indiceSorteado,
            timestamp: agora
        })
    }

    return CHAVES_PIX[indiceSorteado]
}

export default {
    obterChavesPix,
    selecionarChavePixInteligente
}
