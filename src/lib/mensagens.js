/**
 * Gerador de mensagens para o Bot WhatsApp
 * Rei do Churrasco
 * 
 * Todas as mensagens enviadas aos clientes, loja e entregadores
 */

// Configurações da loja
const CONFIG_LOJA = {
    nome: 'REI DO CHURRASCO',
    emoji: '🔥🥩',
    slogan: 'O Melhor Churrasco da Região!',
    localizacao: {
        rua: 'R. Gen. Taumaturgo de Azevedo, n° 279 - Riachinho',
        mapsLink: 'https://maps.google.com/?q=R.+Gen.+Taumaturgo+de+Azevedo,+279+-+Riachinho'
    },
    contato: '(86) 98131-9596',
    site: 'https://reidochurrascobarras.com.br'
}

/**
 * Formata valor monetário
 */
export function formatarMoeda(valor) {
    if (!valor && valor !== 0) return 'R$ 0,00'
    return `R$ ${Number(valor).toFixed(2).replace('.', ',')}`
}

/**
 * Formata telefone para exibição
 * Converte 5586999999999 para (86) 99999-9999
 */
export function formatarTelefone(telefone) {
    if (!telefone) return 'Não informado'

    // Remove caracteres não numéricos
    const numeros = telefone.replace(/\D/g, '')

    // Remove o 55 do início se tiver
    const semPais = numeros.startsWith('55') ? numeros.slice(2) : numeros

    // Formata como (XX) XXXXX-XXXX
    if (semPais.length === 11) {
        return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 7)}-${semPais.slice(7)}`
    } else if (semPais.length === 10) {
        return `(${semPais.slice(0, 2)}) ${semPais.slice(2, 6)}-${semPais.slice(6)}`
    }

    return telefone
}

/**
 * Formata adicionais de um item do pedido
 * Compatível com JSONB do Rei do Churrasco (orders.items)
 */
function formatarAdicionais(item) {
    const adicionaisBrutos = item.adicionais || item.item_adicionais || item.extras || item.complements || []
    const adicionais = Array.isArray(adicionaisBrutos) ? adicionaisBrutos : [adicionaisBrutos]
    if (adicionais.length === 0) return ''

    return adicionais.map(a => {
        const quantidade = numeroSeguro(a?.quantidade || a?.quantity || 1)
        const qtd = quantidade > 1 ? `${quantidade}x ` : ''
        const nome = textoSeguro(a?.nome || a?.nome_adicional || a?.name || a?.label || a?.titulo) || 'Adicional'
        const preco = numeroSeguro(a?.preco || a?.price || a?.valor || a?.amount || 0)
        return `      + ${qtd}${nome} (${formatarMoeda(preco)})`
    }).join('\n')
}

function numeroSeguro(valor) {
    const numero = Number(valor)
    return Number.isFinite(numero) ? numero : 0
}

function textoSeguro(valor) {
    if (valor === null || valor === undefined) return ''

    if (typeof valor === 'string') {
        return valor.trim()
    }

    if (typeof valor === 'number' || typeof valor === 'boolean') {
        return String(valor)
    }

    if (Array.isArray(valor)) {
        return valor
            .map((item) => textoSeguro(item))
            .filter(Boolean)
            .join(', ')
    }

    if (typeof valor === 'object') {
        const chavesPreferidas = [
            'label', 'nome', 'name', 'titulo', 'title',
            'valor', 'value', 'descricao', 'description',
            'texto', 'size', 'tamanho', 'variacao', 'variation'
        ]

        for (const chave of chavesPreferidas) {
            const texto = textoSeguro(valor[chave])
            if (texto) return texto
        }

        const textosPrimitivos = Object.values(valor)
            .map((item) => {
                if (item === null || item === undefined) return ''
                if (typeof item === 'object') return ''
                return textoSeguro(item)
            })
            .filter(Boolean)

        if (textosPrimitivos.length > 0) {
            return textosPrimitivos.join(' - ')
        }
    }

    return ''
}

function normalizarTextoBusca(valor) {
    return textoSeguro(valor)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
}

function obterOpcaoEntrega(pedido) {
    const opcaoEntrega = pedido?.delivery_option

    if (!opcaoEntrega) return {}

    if (typeof opcaoEntrega === 'string') {
        try {
            const parsed = JSON.parse(opcaoEntrega)
            if (parsed && typeof parsed === 'object') return parsed
            return {}
        } catch {
            return {}
        }
    }

    if (typeof opcaoEntrega === 'object' && !Array.isArray(opcaoEntrega)) {
        return opcaoEntrega
    }

    return {}
}

function extrairNumeroMesa(pedido) {
    const opcaoEntrega = obterOpcaoEntrega(pedido)
    const candidatos = [
        opcaoEntrega.tableNumber,
        opcaoEntrega.table_number,
        opcaoEntrega.mesa,
        opcaoEntrega.numeroMesa,
        pedido?.tableNumber,
        pedido?.table_number
    ]

    for (const candidato of candidatos) {
        if (candidato === null || candidato === undefined) continue
        const texto = String(candidato).trim()
        if (!texto || texto === '0' || texto.toLowerCase() === 'null' || texto.toLowerCase() === 'undefined') {
            continue
        }
        return texto
    }

    return ''
}

function obterContextoEntrega(pedido) {
    const opcaoEntrega = obterOpcaoEntrega(pedido)
    const tipoOpcao = normalizarTextoBusca(opcaoEntrega.type || opcaoEntrega.tipo || opcaoEntrega.deliveryType)
    const tipoPedido = normalizarTextoBusca(pedido.order_type || pedido.tipo_entrega)
    const numeroMesa = extrairNumeroMesa(pedido)

    const indicaRetirada =
        tipoOpcao.includes('retirada') ||
        tipoOpcao.includes('takeout') ||
        tipoOpcao.includes('pickup') ||
        tipoOpcao.includes('balcao') ||
        tipoPedido === 'retirada' ||
        tipoPedido === 'takeout' ||
        tipoPedido === 'pickup'

    const indicaLocal =
        Boolean(numeroMesa) ||
        tipoOpcao.includes('no local') ||
        tipoOpcao.includes('consumo no local') ||
        tipoOpcao.includes('consumo') ||
        tipoOpcao.includes('mesa') ||
        tipoPedido === 'local' ||
        tipoPedido === 'dine_in' ||
        tipoPedido === 'mesa'

    const indicaDelivery =
        tipoOpcao.includes('delivery') ||
        tipoOpcao.includes('entrega') ||
        tipoPedido === 'delivery' ||
        tipoPedido === 'entrega'

    if (numeroMesa) {
        return { tipo: 'local', numeroMesa }
    }

    if (indicaRetirada) {
        return { tipo: 'retirada', numeroMesa: '' }
    }

    if (indicaLocal) {
        return { tipo: 'local', numeroMesa: '' }
    }

    if (indicaDelivery) {
        return { tipo: 'delivery', numeroMesa: '' }
    }

    // Fallback seguro para dados inconsistentes
    const enderecoDireto = textoSeguro(pedido.customer_address)
    if (enderecoDireto) {
        return { tipo: 'delivery', numeroMesa: '' }
    }

    return { tipo: 'retirada', numeroMesa: '' }
}

export function pedidoEhDelivery(pedido) {
    return obterContextoEntrega(pedido).tipo === 'delivery'
}

/**
 * Gera bloco textual de cupom/desconto aplicado no pedido
 */
function formatarResumoDesconto(pedido) {
    const codigoCupom = String(pedido.cupom_codigo || '').trim()
    const descontoAplicado = numeroSeguro(pedido.desconto_aplicado)
    const valorDesconto = numeroSeguro(pedido.valor_desconto || pedido.discount_value)
    const descontoTotal = descontoAplicado || valorDesconto

    if (!codigoCupom && descontoTotal <= 0) return ''

    let resumo = ''

    if (codigoCupom) {
        resumo += `\n*🏷️ Cupom aplicado:* ${codigoCupom}`
    }

    if (descontoTotal > 0) {
        resumo += `\n*💸 Desconto:* -${formatarMoeda(descontoTotal)}`
    }

    return resumo
}

/**
 * Extrai endereço do pedido (compatível com JSONB delivery_option e campos diretos)
 */
function extrairEnderecoCompleto(pedido) {
    // Tenta extrair do campo direto
    const enderecoDireto = textoSeguro(pedido.customer_address)
    if (enderecoDireto) {
        return enderecoDireto
    }

    // Tenta extrair do delivery_option (JSONB)
    const opcaoEntrega = obterOpcaoEntrega(pedido)
    if (opcaoEntrega) {
        const partes = []
        const enderecoBase = textoSeguro(
            opcaoEntrega.endereco ||
            opcaoEntrega.address ||
            opcaoEntrega.logradouro ||
            opcaoEntrega.street
        )

        if (enderecoBase) {
            partes.push(enderecoBase)
        }
        const bairro = textoSeguro(opcaoEntrega.bairro || opcaoEntrega.neighborhood)
        if (bairro) {
            partes.push(bairro)
        }
        const complemento = textoSeguro(opcaoEntrega.complemento || opcaoEntrega.complement)
        if (complemento) {
            partes.push(complemento)
        }
        const referencia = textoSeguro(opcaoEntrega.referencia || opcaoEntrega.reference)
        if (referencia) {
            partes.push(`Ref: ${referencia}`)
        }
        if (partes.length > 0) return partes.join(', ')
    }

    return 'Não informado'
}

/**
 * Extrai bairro do pedido
 */
function extrairBairro(pedido) {
    const bairroDireto = textoSeguro(pedido.bairro)
    if (bairroDireto) return bairroDireto
    const opcaoEntrega = obterOpcaoEntrega(pedido)
    if (opcaoEntrega) {
        return textoSeguro(opcaoEntrega.bairro || opcaoEntrega.neighborhood || '')
    }
    return ''
}

/**
 * Extrai complemento do pedido
 */
function extrairComplemento(pedido) {
    const complementoDireto = textoSeguro(pedido.complemento)
    if (complementoDireto) return complementoDireto
    const opcaoEntrega = obterOpcaoEntrega(pedido)
    if (opcaoEntrega) {
        return textoSeguro(opcaoEntrega.complemento || opcaoEntrega.complement || '')
    }
    return ''
}

/**
 * Extrai referência do pedido
 */
function extrairReferencia(pedido) {
    const referenciaDireta = textoSeguro(pedido.referencia)
    if (referenciaDireta) return referenciaDireta
    const opcaoEntrega = obterOpcaoEntrega(pedido)
    if (opcaoEntrega) {
        return textoSeguro(opcaoEntrega.referencia || opcaoEntrega.reference || '')
    }
    return ''
}

/**
 * Extrai taxa de entrega do pedido
 */
function extrairTaxaEntrega(pedido) {
    if (pedido.taxa_entrega) return numeroSeguro(pedido.taxa_entrega)
    const opcaoEntrega = obterOpcaoEntrega(pedido)
    if (opcaoEntrega) {
        return numeroSeguro(opcaoEntrega.taxa || opcaoEntrega.fee || opcaoEntrega.delivery_fee || 0)
    }
    return 0
}

/**
 * Formata itens do pedido (compatível com JSONB orders.items)
 */
function formatarItensPedido(pedido, incluirPreco = true) {
    // Items pode vir como array JSONB diretamente
    const itensBrutos = pedido.items || pedido.itens_pedido || []
    const itens = Array.isArray(itensBrutos) ? itensBrutos : []

    if (itens.length === 0) {
        return '   • Itens não informados'
    }

    return itens.map(item => {
        const quantidade = numeroSeguro(item.quantidade || item.quantity || 1)
        const nome = textoSeguro(item.nome || item.nome_item || item.name || item.product_name) || 'Item'
        const precoUnitario = numeroSeguro(item.preco_unitario || item.price || item.preco || item.basePrice || 0)
        const preco = numeroSeguro(
            item.totalItemPrice ||
            item.subtotal ||
            item.preco_total ||
            item.total ||
            (precoUnitario * quantidade)
        )
        let linha = incluirPreco
            ? `   • ${quantidade}x ${nome} - ${formatarMoeda(preco)}`
            : `   • ${quantidade}x ${nome}`

        const adicionaisTexto = formatarAdicionais(item)
        if (adicionaisTexto) linha += '\n' + adicionaisTexto

        const obs = textoSeguro(item.observacoes || item.observations || item.notes || item.observacao)
        if (obs) linha += `\n      📝 _${obs}_`

        // Variação/tamanho do item (ex: "Marmita Grande")
        const variacao = textoSeguro(
            item.variacao ||
            item.variation ||
            item.tamanho ||
            item.size ||
            item.opcao ||
            item.option ||
            item.selectedOption
        )
        if (variacao) linha += `\n      📏 _${variacao}_`

        return linha
    }).join('\n')
}

/**
 * Gera mensagem de pedido recebido (para a loja)
 */
export function gerarMensagemPedidoRecebido(pedido) {
    const listaItens = formatarItensPedido(pedido, true)
    const bairro = extrairBairro(pedido)
    const complemento = extrairComplemento(pedido)
    const referencia = extrairReferencia(pedido)
    const taxaEntrega = extrairTaxaEntrega(pedido)
    const contextoEntrega = obterContextoEntrega(pedido)

    let tipoEntrega = '🏪 Retirada no balcão'
    let infoEntrega = ''

    if (contextoEntrega.tipo === 'delivery') {
        tipoEntrega = '🛵 Delivery'
        const enderecoCompleto = extrairEnderecoCompleto(pedido)
        infoEntrega = `\n\n*📍 Endereço:*\n${enderecoCompleto}${bairro ? `\n*Bairro:* ${bairro}` : ''}${complemento ? `\n*Complemento:* ${complemento}` : ''}${referencia ? `\n*Referência:* ${referencia}` : ''}`
    } else if (contextoEntrega.tipo === 'local') {
        tipoEntrega = contextoEntrega.numeroMesa
            ? `🍽️ Mesa (${contextoEntrega.numeroMesa})`
            : '🍽️ Consumo no local'
    }

    const formaPagamento = traduzirFormaPagamento(pedido.payment_method || pedido.forma_pagamento)

    let infoTroco = ''
    if (pedido.valor_pago && pedido.valor_pago > pedido.total) {
        const troco = pedido.valor_pago - pedido.total
        infoTroco = `\n💵 *Troco para:* ${formatarMoeda(pedido.valor_pago)} (${formatarMoeda(troco)})`
    } else if (pedido.troco && pedido.troco > 0) {
        infoTroco = `\n💵 *Troco:* ${formatarMoeda(pedido.troco)}`
    }

    const infoDesconto = formatarResumoDesconto(pedido)

    // Garçom que criou o pedido
    const infoGarcom = pedido.waiter_name ? `\n*👨‍🍳 Garçom:* ${pedido.waiter_name}` : ''

    return `${CONFIG_LOJA.emoji} *NOVO PEDIDO - ${CONFIG_LOJA.nome}* ${CONFIG_LOJA.emoji}

*Pedido #${pedido.order_number || pedido.id?.slice(0, 8)}*

*👤 Cliente:* ${pedido.customer_name || 'Cliente'}
${pedido.customer_phone ? `*📞 Telefone:* ${pedido.customer_phone}` : ''}${infoGarcom}

*📋 Itens:*
${listaItens}

*💰 Subtotal:* ${formatarMoeda(pedido.subtotal || pedido.total)}
${taxaEntrega > 0 ? `*🛵 Taxa de Entrega:* ${formatarMoeda(taxaEntrega)}` : ''}
${infoDesconto}
*💰 TOTAL: ${formatarMoeda(pedido.total)}*

*📦 Tipo:* ${tipoEntrega}
*💳 Pagamento:* ${formaPagamento}${infoTroco}${infoEntrega}
${pedido.notes ? `\n*📝 Observações:* ${pedido.notes}` : ''}

⏱️ Tempo estimado: *30-45 minutos*`
}

/**
 * Gera mensagem de confirmação para o cliente
 */
export function gerarMensagemCliente(pedido) {
    const listaItens = formatarItensPedido(pedido, false)
    const taxaEntrega = extrairTaxaEntrega(pedido)
    const contextoEntrega = obterContextoEntrega(pedido)

    let tipoEntrega = '🏪 Retirada no balcão'
    let infoEntregaCliente = ''

    if (contextoEntrega.tipo === 'delivery') {
        tipoEntrega = '🛵 Delivery'
        const enderecoCompleto = extrairEnderecoCompleto(pedido)
        infoEntregaCliente = `\n\n📍 *Entregar em:*\n${enderecoCompleto}`
    } else if (contextoEntrega.tipo === 'local') {
        tipoEntrega = contextoEntrega.numeroMesa
            ? `🍽️ Mesa (${contextoEntrega.numeroMesa})`
            : '🍽️ Consumo no local'
    } else if (contextoEntrega.tipo === 'retirada') {
        tipoEntrega = '🏪 Retirada no balcão'
        infoEntregaCliente = `\n\n📍 *Local de retirada:*\n${CONFIG_LOJA.localizacao.rua}\n🗺️ ${CONFIG_LOJA.localizacao.mapsLink}`
    }

    const total = pedido.total ? formatarMoeda(pedido.total) : ''
    const subtotal = pedido.subtotal ? formatarMoeda(pedido.subtotal) : ''
    const infoDesconto = formatarResumoDesconto(pedido)

    let blocoValores = ''
    if (taxaEntrega > 0 && subtotal) {
        blocoValores = `*💰 Subtotal:* ${subtotal}\n*🛵 Taxa de entrega:* ${formatarMoeda(taxaEntrega)}\n*💰 TOTAL: ${total}*`
    } else {
        blocoValores = `*💰 Total: ${total}*`
    }

    return `${CONFIG_LOJA.emoji} *${CONFIG_LOJA.nome}* ${CONFIG_LOJA.emoji}

✅ *Pedido Confirmado!*

Olá, ${pedido.customer_name || 'Cliente'}! 👋

Seu pedido foi recebido com sucesso!

*📋 Itens:*
${listaItens}

${blocoValores}
${infoDesconto}
*📦 Tipo:* ${tipoEntrega}${infoEntregaCliente}

⏱️ *Tempo estimado: 30-45 minutos*

Obrigado pela preferência! ❤️🔥
_${CONFIG_LOJA.nome} - ${CONFIG_LOJA.slogan}_`
}

/**
 * Gera mensagem para o entregador (apenas quando for delivery)
 */
export function gerarMensagemEntregador(pedido) {
    const listaItens = formatarItensPedido(pedido, false)
    const formaPagamento = traduzirFormaPagamento(pedido.payment_method || pedido.forma_pagamento)
    const telefoneFormatado = formatarTelefone(pedido.customer_phone || pedido.telefone)
    const bairro = extrairBairro(pedido)
    const complemento = extrairComplemento(pedido)
    const enderecoCompleto = extrairEnderecoCompleto(pedido)
    const infoDesconto = formatarResumoDesconto(pedido)

    let infoTroco = ''
    if (pedido.valor_pago && pedido.valor_pago > pedido.total) {
        const troco = pedido.valor_pago - pedido.total
        infoTroco = `\n💵 *Levar troco de:* ${formatarMoeda(troco)}`
    } else if (pedido.troco && pedido.troco > 0) {
        infoTroco = `\n💵 *Levar troco de:* ${formatarMoeda(pedido.troco)}`
    }

    return `🛵 *NOVA ENTREGA - ${CONFIG_LOJA.nome}* 🛵

*Pedido #${pedido.order_number || pedido.id?.slice(0, 8)}*

*👤 Cliente:* ${pedido.customer_name || 'Cliente'}
*📞 Telefone:* ${telefoneFormatado}

*🏘️ Bairro:* ${bairro || 'Não informado'}
*📍 Endereço:* ${enderecoCompleto}
${complemento ? `*🏠 Complemento:* ${complemento}` : ''}

*📋 Itens:*
${listaItens}

*💰 Total: ${formatarMoeda(pedido.total)}*
${infoDesconto}
*💳 Pagamento:* ${formaPagamento}${infoTroco}
${pedido.notes ? `\n*📝 Obs:* ${pedido.notes}` : ''}

_Aguarde o pedido ficar pronto!_ ⏳`
}

/**
 * Gera mensagem de atualização de status
 */
export function gerarMensagemStatusAtualizado(pedido, novoStatus) {
    const statusEmojis = {
        'pending': '⏳',
        'pendente': '⏳',
        'confirmed': '✅',
        'confirmado': '✅',
        'preparing': '👨‍🍳',
        'preparando': '👨‍🍳',
        'ready': '🍽️',
        'pronto': '🍽️',
        'out_for_delivery': '🛵',
        'saiu_entrega': '🛵',
        'delivered': '✅',
        'entregue': '✅',
        'completed': '🎉',
        'finalizado': '🎉',
        'cancelled': '❌',
        'cancelado': '❌'
    }

    const statusTextos = {
        'pending': 'Aguardando confirmação',
        'pendente': 'Aguardando confirmação',
        'confirmed': 'Pedido confirmado',
        'confirmado': 'Pedido confirmado',
        'preparing': 'Preparando pedido',
        'preparando': 'Preparando pedido',
        'ready': 'Pedido pronto',
        'pronto': 'Pedido pronto',
        'out_for_delivery': 'Saiu para entrega',
        'saiu_entrega': 'Saiu para entrega',
        'delivered': 'Pedido entregue',
        'entregue': 'Pedido entregue',
        'completed': 'Pedido finalizado',
        'finalizado': 'Pedido finalizado',
        'cancelled': 'Pedido cancelado',
        'cancelado': 'Pedido cancelado'
    }

    const emoji = statusEmojis[novoStatus] || '📋'
    const texto = statusTextos[novoStatus] || novoStatus

    const contextoEntrega = obterContextoEntrega(pedido)

    let mensagemExtra = ''
    if (novoStatus === 'preparing' || novoStatus === 'preparando') {
        mensagemExtra = '\n\nEstamos preparando com carinho! 🔥🥩'
    } else if (novoStatus === 'ready' || novoStatus === 'pronto') {
        if (contextoEntrega.tipo === 'retirada') {
            mensagemExtra = `\n\nPedido pronto para retirada!\n\n📍 *Local:*\n${CONFIG_LOJA.localizacao.rua}\n🗺️ ${CONFIG_LOJA.localizacao.mapsLink}`
        } else if (contextoEntrega.tipo === 'local') {
            mensagemExtra = contextoEntrega.numeroMesa
                ? `\n\nPedido pronto para consumo na Mesa ${contextoEntrega.numeroMesa}!`
                : '\n\nPedido pronto para consumo no local!'
        } else {
            mensagemExtra = '\n\nPedido pronto para retirada/entrega!'
        }
    } else if (novoStatus === 'out_for_delivery' || novoStatus === 'saiu_entrega') {
        mensagemExtra = '\n\nEntregador a caminho! 🏍️'
    } else if (novoStatus === 'delivered' || novoStatus === 'entregue' || novoStatus === 'completed' || novoStatus === 'finalizado') {
        mensagemExtra = '\n\nObrigado pela preferência! ❤️🔥'
    }

    return `${CONFIG_LOJA.emoji} *${CONFIG_LOJA.nome}* ${CONFIG_LOJA.emoji}

${emoji} *Atualização do Pedido #${pedido.order_number || pedido.id?.slice(0, 8)}*

*Status:* ${texto}${mensagemExtra}`
}

/**
 * Traduz forma de pagamento
 */
function traduzirFormaPagamento(metodo) {
    if (!metodo) return 'Não informado'
    const metodoLower = metodo.toLowerCase()
    const traducoes = {
        'cash': '💵 Dinheiro',
        'dinheiro': '💵 Dinheiro',
        'pix': '📱 PIX',
        'credit': '💳 Cartão de Crédito',
        'credit_card': '💳 Cartão de Crédito',
        'credito': '💳 Cartão de Crédito',
        'cartão': '💳 Cartão',
        'cartao': '💳 Cartão',
        'debit': '💳 Cartão de Débito',
        'debit_card': '💳 Cartão de Débito',
        'debito': '💳 Cartão de Débito',
        'dividido': '💳 Pagamento Dividido',
        'crediario': '📒 Crediário'
    }
    return traducoes[metodoLower] || metodo
}

export default {
    gerarMensagemPedidoRecebido,
    gerarMensagemCliente,
    gerarMensagemStatusAtualizado,
    gerarMensagemEntregador,
    pedidoEhDelivery,
    formatarMoeda,
    CONFIG_LOJA
}
