require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const paymentController = require('./PaymentController');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Rota de Diagnóstico
app.get('/', (req, res) => {
    res.send('SightAI API - Online 🚀');
});

// Rotas de Pagamento
app.post('/payments/create-payment', (req, res) => paymentController.createPayment(req, res));
app.post('/webhook', (req, res) => paymentController.handleWebhook(req, res));

// Configuração da Porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[SightAI] Servidor rodando na porta ${PORT}`);
});
