/**
 * Auth State customizado para Baileys v7 com Supabase
 * Armazena credenciais e estado de autenticação no banco de dados
 * Rei do Churrasco
 * 
 * Versão otimizada com:
 * - Cache local para reduzir chamadas ao banco
 * - Operações em batch para melhor performance
 * - Tratamento robusto de erros
 * - Logs detalhados para debugging
 */

import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys'
import { supabase } from './supabase.js'

const SESSION_ID = process.env.SESSION_ID || 'rei-do-churrasco'

// Cache local para reduzir chamadas ao banco
const cacheLocal = new Map()
let credenciaisAtuais = null

/**
 * Serializa valor para armazenamento no banco
 */
function serializar(valor) {
    try {
        return JSON.parse(JSON.stringify(valor, BufferJSON.replacer))
    } catch (erro) {
        console.error('[AUTH] Erro ao serializar:', erro.message)
        return null
    }
}

/**
 * Deserializa valor do banco
 */
function deserializar(valor) {
    try {
        if (!valor) return null
        return JSON.parse(JSON.stringify(valor), BufferJSON.reviver)
    } catch (erro) {
        console.error('[AUTH] Erro ao deserializar:', erro.message)
        return null
    }
}

/**
 * Lê um dado do banco de dados com cache
 */
async function lerDado(chave) {
    // Verifica cache primeiro
    if (cacheLocal.has(chave)) {
        return cacheLocal.get(chave)
    }

    try {
        const { data, error } = await supabase
            .from('whatsapp_session')
            .select('data_value')
            .eq('session_id', SESSION_ID)
            .eq('data_key', chave)
            .maybeSingle()

        if (error) {
            console.error(`[AUTH] Erro ao ler ${chave}:`, error.message)
            return null
        }

        const valor = data?.data_value || null
        if (valor) {
            cacheLocal.set(chave, valor)
        }
        return valor
    } catch (erro) {
        console.error(`[AUTH] Erro ao ler ${chave}:`, erro.message)
        return null
    }
}

/**
 * Salva um dado no banco de dados e atualiza cache
 */
async function salvarDado(chave, valor) {
    try {
        // Atualiza cache local
        cacheLocal.set(chave, valor)

        const { error } = await supabase
            .from('whatsapp_session')
            .upsert({
                id: `${SESSION_ID}_${chave}`,
                session_id: SESSION_ID,
                data_key: chave,
                data_value: valor,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'id'
            })

        if (error) {
            console.error(`[AUTH] Erro ao salvar ${chave}:`, error.message)
            return false
        }
        return true
    } catch (erro) {
        console.error(`[AUTH] Erro ao salvar ${chave}:`, erro.message)
        return false
    }
}

/**
 * Remove um dado do banco de dados e do cache
 */
async function removerDado(chave) {
    try {
        cacheLocal.delete(chave)

        const { error } = await supabase
            .from('whatsapp_session')
            .delete()
            .eq('session_id', SESSION_ID)
            .eq('data_key', chave)

        if (error) {
            console.error(`[AUTH] Erro ao remover ${chave}:`, error.message)
        }
    } catch (erro) {
        console.error(`[AUTH] Erro ao remover ${chave}:`, erro.message)
    }
}

/**
 * Salva múltiplas chaves em batch
 */
async function salvarEmBatch(registros) {
    if (registros.length === 0) return

    try {
        const dadosParaUpsert = registros.map(({ chave, valor }) => {
            cacheLocal.set(chave, valor)
            return {
                id: `${SESSION_ID}_${chave}`,
                session_id: SESSION_ID,
                data_key: chave,
                data_value: valor,
                updated_at: new Date().toISOString()
            }
        })

        const { error } = await supabase
            .from('whatsapp_session')
            .upsert(dadosParaUpsert, { onConflict: 'id' })

        if (error) {
            console.error('[AUTH] Erro ao salvar em batch:', error.message)
        }
    } catch (erro) {
        console.error('[AUTH] Erro ao salvar em batch:', erro.message)
    }
}

/**
 * Cria um auth state que persiste no Supabase
 */
export async function useSupabaseAuthState() {
    console.log('[AUTH] Iniciando auth state do Supabase...')
    console.log(`[AUTH] Session ID: ${SESSION_ID}`)

    // Limpa cache local ao iniciar
    cacheLocal.clear()

    // Carrega credenciais existentes do banco
    const credsData = await lerDado('creds')

    if (credsData) {
        credenciaisAtuais = deserializar(credsData)
        console.log('[AUTH] Credenciais existentes carregadas do banco')

        // Verifica se as credenciais têm os campos essenciais
        if (credenciaisAtuais?.me?.id) {
            console.log(`[AUTH] Sessão anterior encontrada para: ${credenciaisAtuais.me.id}`)
        }
    } else {
        credenciaisAtuais = initAuthCreds()
        console.log('[AUTH] Novas credenciais inicializadas')
    }

    // Retorna o state compatível com Baileys v7
    return {
        state: {
            creds: credenciaisAtuais,
            keys: {
                get: async (tipo, ids) => {
                    const resultado = {}

                    for (const id of ids) {
                        const chave = `${tipo}-${id}`
                        const valor = await lerDado(chave)

                        if (valor) {
                            const valorDeserializado = deserializar(valor)
                            if (valorDeserializado) {
                                resultado[id] = valorDeserializado
                            }
                        }
                    }

                    return resultado
                },
                set: async (dados) => {
                    const registrosParaSalvar = []
                    const chavesParaRemover = []

                    for (const [tipo, valores] of Object.entries(dados)) {
                        if (!valores) continue

                        for (const [id, valor] of Object.entries(valores)) {
                            const chave = `${tipo}-${id}`

                            if (valor) {
                                const valorSerializado = serializar(valor)
                                if (valorSerializado) {
                                    registrosParaSalvar.push({ chave, valor: valorSerializado })
                                }
                            } else {
                                chavesParaRemover.push(chave)
                            }
                        }
                    }

                    // Salva em batch para melhor performance
                    if (registrosParaSalvar.length > 0) {
                        await salvarEmBatch(registrosParaSalvar)
                    }

                    // Remove chaves marcadas para remoção
                    for (const chave of chavesParaRemover) {
                        await removerDado(chave)
                    }
                }
            }
        },
        saveCreds: async () => {
            try {
                // Serializa as credenciais atuais (que são modificadas pelo Baileys por referência)
                const credsSerializados = serializar(credenciaisAtuais)

                if (!credsSerializados) {
                    console.error('[AUTH] Falha ao serializar credenciais')
                    return
                }

                const sucesso = await salvarDado('creds', credsSerializados)

                if (sucesso) {
                    console.log('[AUTH] Credenciais salvas com sucesso')
                } else {
                    console.error('[AUTH] Falha ao salvar credenciais no banco')
                }
            } catch (erro) {
                console.error('[AUTH] Erro ao salvar credenciais:', erro.message)
            }
        }
    }
}

/**
 * Verifica se existe uma sessão válida no banco
 */
export async function verificarSessaoExistente() {
    try {
        const credsData = await lerDado('creds')
        if (!credsData) return false

        const creds = deserializar(credsData)
        return creds?.me?.id ? true : false
    } catch (erro) {
        console.error('[AUTH] Erro ao verificar sessão:', erro.message)
        return false
    }
}

/**
 * Limpa toda a sessão do banco de dados
 */
export async function limparSessao() {
    try {
        // Limpa cache local
        cacheLocal.clear()
        credenciaisAtuais = null

        const { error, count } = await supabase
            .from('whatsapp_session')
            .delete()
            .eq('session_id', SESSION_ID)

        if (error) throw error
        console.log(`[AUTH] Sessão limpa com sucesso (${count || 'N'} registros removidos)`)
    } catch (erro) {
        console.error('[AUTH] Erro ao limpar sessão:', erro.message)
    }
}

export default useSupabaseAuthState
