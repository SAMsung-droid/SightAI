const { MercadoPagoConfig, Payment } = require('mercadopago');
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

class PaymentController {
    constructor() {
        // Inicializa o cliente com o Access Token do ambiente
        this.client = new MercadoPagoConfig({
            accessToken: process.env.MP_ACCESS_TOKEN
        });
        this.payment = new Payment(this.client);
    }

    /**
     * Cria um pagamento para diferentes métodos (PIX, Crédito, Boleto)
     */
    async createPayment(req, res) {
        try {
            const { amount, method, details } = req.body;

            // Validação básica
            if (!amount || !method) {
                return res.status(400).json({ error: 'Amount e method são obrigatórios.' });
            }

            // Estrutura base do pagamento
            let paymentData = {
                body: {
                    transaction_amount: Number(amount),
                    description: "Pagamento SightAI - Acesso Premium",
                    payment_method_id: method,
                    payer: {
                        email: details?.email || 'test@test.com'
                    }
                }
            };

            // Lógica específica por método
            switch (method) {
                case 'pix':
                    // PIX já é o padrão com os dados acima, mas podemos adicionar tempo de expiração se necessário
                    break;

                case 'credit_card':
                case 'debit_card':
                    if (!details.token) throw new Error('Token do cartão é obrigatório para este método.');
                    paymentData.body = {
                        ...paymentData.body,
                        token: details.token,
                        installments: details.installments || 1,
                        payer: {
                            ...paymentData.body.payer,
                            first_name: details.first_name,
                            last_name: details.last_name,
                            identification: {
                                type: details.identificationType,
                                number: details.identificationNumber
                            }
                        }
                    };
                    break;

                case 'bolbradesco': // No Mercado Pago v2, usa-se o ID do meio específico (ex: bolbradesco)
                case 'pec':
                    paymentData.body = {
                        ...paymentData.body,
                        payer: {
                            ...paymentData.body.payer,
                            first_name: details.first_name,
                            last_name: details.last_name,
                            identification: {
                                type: details.identificationType,
                                number: details.identificationNumber
                            },
                            address: details.address
                        }
                    };
                    break;

                default:
                    return res.status(400).json({ error: 'Método de pagamento não suportado.' });
            }

            // Executa a criação no Mercado Pago
            const result = await this.payment.create(paymentData);

            // ✅ PASSO 2 — Salvar no Banco (Atualizado com statusDetail e camelCase)
            await prisma.payment.create({
                data: {
                    mpId: result.id.toString(),
                    status: result.status,
                    statusDetail: result.status_detail,
                    method: result.payment_method_id,
                    amount: result.transaction_amount,
                    qr_code: result.point_of_interaction?.transaction_data?.qr_code || null,
                    boleto_url: result.transaction_details?.external_resource_url || null,
                    payer_email: details?.email || null,
                    payer_name: details?.first_name
                        ? `${details.first_name} ${details.last_name || ''}`.trim()
                        : null
                }
            });

            // Formata a resposta profissionalmente para o frontend
            const formattedResponse = this.formatResponse(method, result);

            return res.status(201).json(formattedResponse);

        } catch (error) {
            console.error('Erro no createPayment:', error);
            return res.status(error.status || 500).json({
                error: 'Erro ao processar pagamento.',
                details: error.message
            });
        }
    }

    /**
     * Webhook para notificações de status (Atualizado com PASSO 3)
     */
    async handleWebhook(req, res) {
        try {
            const { action, data, type } = req.body;

            // Suporta tanto o formato 'type === payment' quanto 'action === payment.updated'
            if ((type === 'payment' || action === 'payment.updated') && data?.id) {
                const paymentId = data.id;
                console.log(`[Webhook] Atualizando pagamento: ${paymentId}`);

                // Busca o status atualizado no Mercado Pago
                const paymentInfo = await this.payment.get({ id: paymentId });

                // Atualiza o status no Banco de Dados
                await prisma.payment.update({
                    where: { mpId: paymentId.toString() },
                    data: {
                        status: paymentInfo.status,
                        statusDetail: paymentInfo.status_detail
                    }
                });

                console.log(`[Webhook] Sucesso: ${paymentId} -> ${paymentInfo.status}`);
            }

            // Sempre responder 200/OK para o Mercado Pago
            return res.sendStatus(200);

        } catch (error) {
            console.error('Erro no Webhook:', error);
            // Retornamos 500 para que o MP tente reenviar a notificação depois
            return res.sendStatus(500);
        }
    }

    /**
     * Padroniza o que o frontend recebe
     */
    formatResponse(method, mpResult) {
        const { id, status, status_detail, point_of_interaction, transaction_details } = mpResult;

        let response = {
            id,
            status,
            status_detail
        };

        if (method === 'pix') {
            response.pix = {
                qr_code: point_of_interaction.transaction_data.qr_code,
                qr_code_base64: point_of_interaction.transaction_data.qr_code_base64,
                ticket_url: point_of_interaction.transaction_data.ticket_url
            };
        }

        if (method === 'bolbradesco' || method === 'bolsantander') {
            response.boleto = {
                url: transaction_details.external_resource_url,
                bar_code: transaction_details.barcode?.content
            };
        }

        return response;
    }
}

module.exports = new PaymentController();
