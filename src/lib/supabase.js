/**
 * Cliente Supabase para o Bot WhatsApp
 * Rei do Churrasco
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl) {
    console.error('[SUPABASE] SUPABASE_URL não configurada!')
}

if (!supabaseServiceKey && !supabaseAnonKey) {
    console.error('[SUPABASE] Nenhuma chave configurada!')
    console.error('Configure SUPABASE_SERVICE_KEY ou SUPABASE_ANON_KEY')
}

// Usa service key para operações do banco, anon key para realtime
const chaveParaUsar = supabaseAnonKey || supabaseServiceKey

console.log('[SUPABASE] Usando chave:', supabaseAnonKey ? 'ANON_KEY' : 'SERVICE_KEY')

export const supabase = createClient(supabaseUrl || '', chaveParaUsar || '', {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    },
    realtime: {
        params: {
            eventsPerSecond: 10
        }
    }
})

/**
 * Busca entregadores ativos que recebem mensagens do bot
 * No Rei do Churrasco, a tabela funcionarios usa o campo 'cargo' para identificar entregadores
 * @returns {Promise<Array>} Lista de entregadores ativos
 */
export async function buscarEntregadoresAtivos() {
    try {
        const { data, error } = await supabase
            .from('funcionarios')
            .select('id, nome, telefone, cargo')
            .eq('cargo', 'entregador')
            .eq('ativo', true)

        if (error) {
            console.error('[SUPABASE] Erro ao buscar entregadores:', error.message)
            return []
        }

        // Filtra apenas entregadores que têm telefone cadastrado
        return (data || []).filter(e => e.telefone)
    } catch (erro) {
        console.error('[SUPABASE] Erro ao buscar entregadores:', erro.message)
        return []
    }
}

/**
 * Verifica se um número de telefone pertence a um entregador ativo
 * @param {string} telefone - Número de telefone para verificar
 * @returns {Promise<Object|null>} Dados do entregador ou null
 */
export async function verificarEntregador(telefone) {
    if (!telefone) return null

    // Remove caracteres não numéricos
    const telefoneNormalizado = telefone.replace(/\D/g, '')

    // Remove o prefixo 55 se existir para comparação
    const telefoneSemPrefixo = telefoneNormalizado.startsWith('55')
        ? telefoneNormalizado.substring(2)
        : telefoneNormalizado

    try {
        const { data, error } = await supabase
            .from('funcionarios')
            .select('id, nome, telefone, cargo')
            .eq('cargo', 'entregador')
            .eq('ativo', true)

        if (error) {
            console.error('[SUPABASE] Erro ao verificar entregador:', error.message)
            return null
        }

        // Busca entregador pelo telefone (comparando versões normalizadas)
        const entregador = data?.find(f => {
            const telFuncionario = f.telefone?.replace(/\D/g, '') || ''
            return telFuncionario === telefoneSemPrefixo ||
                telFuncionario === telefoneNormalizado ||
                `55${telFuncionario}` === telefoneNormalizado
        })

        return entregador || null
    } catch (erro) {
        console.error('[SUPABASE] Erro ao verificar entregador:', erro.message)
        return null
    }
}

export default supabase
