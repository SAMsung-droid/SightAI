// Configuração Global do PDF.js (Versão LEGACY para máxima compatibilidade em Mobile)
const PDFJS_VERSION = '3.11.174';
if (typeof pdfjsLib !== 'undefined') {
    // Usando versão NÃO-MINIFICADA no worker para evitar erro de 'WorkerMessageHandler of undefined' no mobile
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.js`;
}

const SightAI = {
    state: {
        mp: null,
        bricksBuilder: null,
        cardPaymentBrickController: null,
        currentText: "",
        isProcessing: false,
        isSpeaking: false,
        isPaused: false,
        currentCharIndex: 0,
        synth: window.speechSynthesis,
        utterance: null,
        highContrast: false,
        voiceCommandActive: false,
        abnt: {
            institution: "",
            author: "",
            advisor: "",
            title: "",
            subtitle: "",
            nature: "",
            city: "",
            year: "",
            isPremium: false,
            activePlan: "gratuito"
        }
    },

    // 1. Inicialização
    init() {
        try {
            console.log("Iniciando SightAI...");
            this.cacheDOM();
            this.bindEvents();
            this.initMercadoPago();
            this.runSelfTest();
            this.announce("SightAI iniciado.");
        } catch (error) {
            console.error("Erro fatal na inicialização:", error);
        }
    },

    initMercadoPago() {
        this.state.mp = new MercadoPago('TEST-e69c9c32-cf87-49a2-8422-0d006665a2e8');
        this.state.bricksBuilder = this.state.mp.bricks();
    },

    // Verifica se as bibliotecas externas estão prontas (Modo Silencioso)
    runSelfTest() {
        const isDocxLoaded = (typeof window.docx !== 'undefined' || typeof docx !== 'undefined');

        const checks = {
            "PDF.js": typeof pdfjsLib !== 'undefined',
            "Tesseract.js": typeof Tesseract !== 'undefined',
            "Docx.js": isDocxLoaded
        };

        const missing = Object.keys(checks).filter(k => !checks[k]);

        if (missing.length > 0) {
            console.warn("SightAI - Funcionalidades pendentes: " + missing.join(", "));
        } else {
            console.log("SightAI - Motores carregados com sucesso.");
        }
    },

    cacheDOM() {
        this.ui = {
            dropzone: document.getElementById('dropzone'),
            fileInput: document.getElementById('file-input'),
            sections: {
                upload: document.getElementById('upload-section'),
                processing: document.getElementById('processing-section'),
                results: document.getElementById('results-section')
            },
            progress: document.getElementById('progress-indicator'),
            statusText: document.getElementById('status-text'),
            outputText: document.getElementById('output-text'),
            btnPlay: document.getElementById('btn-play-pause'),
            btnExport: document.getElementById('btn-export-docx'),
            btnCopy: document.getElementById('btn-copy'),
            btnSummarize: document.getElementById('btn-summarize'),
            audioProgress: document.getElementById('audio-progress'),
            voiceSpeed: document.getElementById('voice-speed'),
            aiInsight: document.getElementById('ai-insight'),
            btnContrast: document.getElementById('toggle-contrast'),
            btnVoiceCmd: document.getElementById('toggle-voice-cmd'),
            btnRestart: document.getElementById('btn-restart'),
            btnContinue: document.getElementById('btn-continue'),
            btnConfigAbnt: document.getElementById('btn-config-abnt'),
            btnExportAbnt: document.getElementById('btn-export-abnt'),
            btnCloseAbnt: document.getElementById('btn-close-abnt'),
            abntCard: document.getElementById('abnt-config-card'),
            abntInputs: {
                institution: document.getElementById('abnt-institution'),
                author: document.getElementById('abnt-author'),
                advisor: document.getElementById('abnt-advisor'),
                title: document.getElementById('abnt-title'),
                subtitle: document.getElementById('abnt-subtitle'),
                nature: document.getElementById('abnt-nature'),
                city: document.getElementById('abnt-city'),
                year: document.getElementById('abnt-year')
            },
            paymentModal: document.getElementById('payment-modal'),
            btnClosePayment: document.getElementById('btn-close-payment'),
            btnPlanMonthly: document.querySelector('#card-monthly .btn'),
            btnPlanAnnual: document.querySelector('#card-annual .btn'),
            paymentPlans: document.getElementById('payment-plans'),
            mpInterface: document.getElementById('mercado-pago-ui'),
            btnBackPlans: document.getElementById('btn-back-plans'),
            paymentFooter: document.getElementById('payment-footer-text'),
            premiumSection: document.getElementById('premium-status-section'),
            btnGoToAbnt: document.getElementById('btn-go-to-abnt')
        };
    },

    bindEvents() {
        // Eventos de Upload
        this.ui.dropzone.addEventListener('click', () => {
            console.log("Dropzone clicado - Abrindo seletor de arquivos");
            this.ui.fileInput.click();
        });

        this.ui.fileInput.addEventListener('change', (e) => {
            console.log("Arquivo selecionado:", e.target.files[0]?.name);
            this.handleFile(e.target.files[0]);
        });

        this.ui.dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.ui.dropzone.classList.add('dragover');
        });
        this.ui.dropzone.addEventListener('dragleave', () => this.ui.dropzone.classList.remove('dragover'));
        this.ui.dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.ui.dropzone.classList.remove('dragover');
            this.handleFile(e.dataTransfer.files[0]);
        });

        // Controls
        this.ui.btnPlay.addEventListener('click', () => this.toggleSpeech());
        this.ui.btnContrast.addEventListener('click', () => this.toggleContrast());
        this.ui.btnVoiceCmd.addEventListener('click', () => this.toggleVoiceCommands());
        this.ui.btnExport.addEventListener('click', () => this.exportToDocx(false));
        this.ui.btnExportAbnt.addEventListener('click', () => this.exportToDocx(true));
        this.ui.btnCopy.addEventListener('click', () => this.copyToClipboard());
        this.ui.btnSummarize.addEventListener('click', () => this.generateAISummary());

        // Sync Textarea with State
        this.ui.outputText.addEventListener('input', (e) => {
            this.state.currentText = e.target.value;
        });

        // Voice Speed update
        this.ui.voiceSpeed.addEventListener('input', () => {
            if (this.state.isSpeaking || this.state.isPaused) {
                this.stopSpeech();
                this.startSpeech(this.state.currentCharIndex);
            }
        });

        // Audio Progress seeking
        this.ui.audioProgress.addEventListener('change', () => {
            const percent = parseFloat(this.ui.audioProgress.value);
            const newIndex = Math.floor((percent / 100) * this.state.currentText.length);
            this.state.currentCharIndex = newIndex;

            if (this.state.isSpeaking || this.state.isPaused) {
                this.stopSpeech();
                this.startSpeech(newIndex);
            }
        });

        this.ui.btnRestart.addEventListener('click', () => this.resetApp());
        this.ui.btnContinue.addEventListener('click', () => {
            console.log("Continuando edição...");
            this.announce("Você pode continuar editando ou exportando seu texto.");
        });

        // ABNT UI Events
        this.ui.btnConfigAbnt.addEventListener('click', () => {
            this.togglePaymentModal(true);
        });

        this.ui.btnGoToAbnt.addEventListener('click', () => {
            this.togglePaymentModal(false);
            this.ui.abntCard.classList.remove('hidden');
        });

        this.ui.btnCloseAbnt.addEventListener('click', () => {
            this.ui.abntCard.classList.add('hidden');
        });

        Object.keys(this.ui.abntInputs).forEach(key => {
            this.ui.abntInputs[key].addEventListener('input', (e) => {
                this.state.abnt[key] = e.target.value;
            });
        });

        // Payment Modal Events
        this.ui.btnClosePayment.addEventListener('click', () => this.togglePaymentModal(false));
        this.ui.btnPlanMonthly.addEventListener('click', () => this.showPaymentOptions('mensal'));
        this.ui.btnPlanAnnual.addEventListener('click', () => this.showPaymentOptions('anual'));

        this.ui.btnBackPlans.addEventListener('click', () => {
            if (this.state.cardPaymentBrickController) {
                this.state.cardPaymentBrickController.unmount();
            }
            this.togglePaymentView('plans');
        });

        // Close modal on overlay click
        this.ui.paymentModal.addEventListener('click', (e) => {
            if (e.target === this.ui.paymentModal) this.togglePaymentModal(false);
        });

        document.getElementById('btn-free-tier').addEventListener('click', () => {
            alert("Você já está no plano Gratuito. Faça upgrade para desbloquear mais recursos!");
        });
    },

    togglePaymentModal(show) {
        if (show) {
            this.togglePaymentView('plans');
            this.updateActivePlanUI();
            this.ui.paymentModal.classList.add('active');
            this.announce("Upgrade para Premium: R$ 3,99 mensal ou R$ 39,99 anual.");
        } else {
            this.ui.paymentModal.classList.remove('active');
        }
    },

    updateActivePlanUI() {
        const { activePlan } = this.state.abnt;

        // Reset all badges and buttons
        document.querySelectorAll('.active-plan-badge').forEach(b => b.classList.add('hidden'));
        document.querySelectorAll('.pricing-card button').forEach(b => {
            b.textContent = "Assinar Agora";
            b.classList.remove('btn-success');
        });

        // Highlight active plan
        const cardId = activePlan === 'anual' ? 'card-annual' : (activePlan === 'mensal' ? 'card-monthly' : 'card-free');
        const card = document.getElementById(cardId);

        if (this.state.abnt.isPremium) {
            this.ui.premiumSection.classList.remove('hidden');
        } else {
            this.ui.premiumSection.classList.add('hidden');
        }

        if (card) {
            card.querySelector('.active-plan-badge').classList.remove('hidden');
            const btn = card.querySelector('.btn');
            if (activePlan === 'gratuito') {
                btn.textContent = "Plano Atual";
            } else {
                btn.textContent = "Plano Ativo";
                btn.style.background = "var(--success)";
                btn.style.color = "#fff";
            }
        }
    },

    togglePaymentView(view) {
        if (view === 'plans') {
            this.ui.paymentPlans.classList.remove('hidden');
            this.ui.mpInterface.classList.add('hidden');
            this.ui.paymentFooter.classList.remove('hidden');
        } else {
            this.ui.paymentPlans.classList.add('hidden');
            this.ui.mpInterface.classList.remove('hidden');
            this.ui.paymentFooter.classList.add('hidden');
            // this.ui.mpProcessing.classList.add('hidden'); // This element doesn't exist in cacheDOM
            document.querySelector('.mp-options')?.classList.remove('hidden'); // Use optional chaining
        }
    },

    async showPaymentOptions(plan) {
        this.state.selectedPlan = plan;
        this.togglePaymentView('mp');

        const amount = plan === 'anual' ? 39.99 : 3.99;
        const description = plan === 'anual' ? 'Assinatura Anual SightAI' : 'Assinatura Mensal SightAI';

        const settings = {
            initialization: {
                amount: amount,
                payer: {
                    email: "test_user@email.com", // Em produção, pegar o email do usuário
                },
            },
            customization: {
                visual: {
                    style: {
                        theme: 'dark',
                    },
                },
                paymentMethods: {
                    maxInstallments: 12,
                }
            },
            callbacks: {
                onReady: () => {
                    console.log("Brick Pronto");
                },
                onSubmit: (formData) => {
                    return new Promise((resolve, reject) => {
                        fetch("http://localhost:3000/process_payment", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                                formData: {
                                    ...formData,
                                    description: description,
                                    transaction_amount: amount
                                }
                            }),
                        })
                            .then((response) => response.json())
                            .then((result) => {
                                if (result.status === 'approved') {
                                    this.handlePaymentSuccess();
                                    resolve();
                                } else {
                                    alert("Pagamento não aprovado: " + result.status);
                                    reject();
                                }
                            })
                            .catch((error) => {
                                console.error("Erro no fetch:", error);
                                alert("Erro ao conectar com o servidor.");
                                reject();
                            });
                    });
                },
                onError: (error) => {
                    console.error("Erro no Brick:", error);
                },
            },
        };

        this.state.cardPaymentBrickController = await this.state.bricksBuilder.create(
            'cardPayment',
            'cardPaymentBrick_container',
            settings
        );
    },

    handlePaymentSuccess() {
        this.state.abnt.isPremium = true;
        this.state.abnt.activePlan = this.state.selectedPlan;
        this.togglePaymentModal(false);
        this.announce("Pagamento confirmado via Mercado Pago!");

        const planText = this.state.selectedPlan === 'anual' ? 'Anual' : 'Mensal';
        alert(`Pagamento ${planText} via Cartão confirmado! SightAI Premium ativado.`);
    },

    // 2. Processamento de Arquivo
    async handleFile(file) {
        if (!file || file.type !== 'application/pdf') {
            this.announce("Erro: Apenas arquivos PDF são suportados.");
            return;
        }

        this.switchSection('processing');
        this.updateStatus(10, "Lendo arquivo...");

        try {
            const arrayBuffer = await file.arrayBuffer();
            // Configuração extra para garantir que o worker carregue corretamente em mobile
            const pdf = await pdfjsLib.getDocument({
                data: arrayBuffer,
                disableFontFace: true // Melhora estabilidade em mobile
            }).promise;

            this.updateStatus(30, "Analisando estrutura das páginas...");
            let fullText = "";
            let isScanned = false;

            // Analisa as primeiras páginas para detectar se é selecionável
            const firstPage = await pdf.getPage(1);
            const content = await firstPage.getTextContent();

            if (content.items.length === 0) {
                isScanned = true;
                this.ui.aiInsight.textContent = "Insight: PDF Escaneado Detectado. Iniciando OCR...";
                this.ui.aiInsight.style.background = "var(--accent-red)";
                fullText = await this.performOCR(pdf);
            } else {
                this.ui.aiInsight.textContent = "Insight: PDF Selecionável Detectado. Extração Direta.";
                this.ui.aiInsight.style.background = "var(--success)";
                fullText = await this.extractText(pdf);
            }

            this.state.currentText = this.reflowText(fullText);
            this.showResults(this.state.currentText);

        } catch (error) {
            console.error("ERRO NO SIGHTAI:", error);
            this.updateStatus(0, "Erro: " + (error.message || "Falha ao ler PDF."));
            // Re-throw para garantir que o erro propague se necessário, mas já exibimos no status.
        }
    },

    // 3. Extração de Texto Direta
    async extractText(pdf) {
        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(" ") + "\n\n";
            this.updateStatus(30 + (i / pdf.numPages) * 60, `Extraindo página ${i}...`);
        }
        return text;
    },

    // 4. Advanced OCR (Tesseract.js)
    reflowText(text) {
        if (!text) return "";

        // 1. Remove scan artifacts
        let cleaned = text
            .replace(/Digitalizado com CamScanner/gi, '')
            .replace(/CamScanner/gi, '')
            .replace(/Página \d+/g, '');

        // 2. Reflow lines: join lines that don't end in sentence-ending punctuation
        const lines = cleaned.split('\n');
        let reflowed = "";

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line) {
                reflowed += "\n\n";
                continue;
            }

            // Remove internal hyphenation (word- at end of line)
            if (line.endsWith('-')) {
                line = line.slice(0, -1);
                reflowed += line;
                continue;
            }

            reflowed += line;

            // If line doesn't end with . ! ? : or a common lowercase start for next line, add space.
            // Otherwise add newline.
            const nextLine = (lines[i + 1] || "").trim();
            const endsInPunct = /[.!?:;]$/.test(line);
            const nextIsCap = /^[A-Z0-9]/.test(nextLine);

            if (!endsInPunct && !nextIsCap && nextLine) {
                reflowed += " ";
            } else {
                reflowed += "\n";
            }
        }

        return reflowed
            .replace(/\n{3,}/g, '\n\n') // Normalize multiple breaks
            .trim();
    },

    async performOCR(pdf) {
        let text = "";

        // ESCALA REDUZIDA PARA MOBILE (2.0) conforme solicitado para evitar crash
        const isMobile = window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const ocrScale = isMobile ? 2.0 : 3.0;

        console.log(`Iniciando OCR com escala: ${ocrScale} (${isMobile ? 'Mobile' : 'Desktop'})`);

        const worker = await Tesseract.createWorker('por', 1, {
            logger: m => {
                if (m.status === 'recognizing text') {
                    this.updateStatus(30 + (m.progress * 60), `Lendo: ${Math.round(m.progress * 100)}%`);
                }
            }
        });

        for (let i = 1; i <= pdf.numPages; i++) {
            this.updateStatus(30 + (i / pdf.numPages) * 60, `OCR página ${i}...`);
            const page = await pdf.getPage(i);

            const viewport = page.getViewport({ scale: ocrScale });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            // Filtros para melhorar precisão
            context.filter = 'grayscale(100%) contrast(150%) brightness(110%)';

            await page.render({ canvasContext: context, viewport }).promise;

            const { data: { text: pageText } } = await worker.recognize(canvas);

            const cleanedPageText = this.cleanOCRNoise(pageText);
            text += cleanedPageText + "\n\n";
        }

        await worker.terminate();
        return text;
    },

    cleanOCRNoise(content) {
        if (!content) return "";
        return content
            .replace(/[~^`|#\\]/g, '')
            .replace(/ +/g, ' ')
            .split('\n')
            .filter(line => {
                const alphaLength = line.replace(/[^a-zA-ZáéíóúÁÉÍÓÚçÇ]/g, '').length;
                return line.length === 0 || alphaLength / line.length > 0.3;
            })
            .join('\n')
            .replace(/-\n/g, '');
    },

    // 5. TTS Features
    startSpeech(startIndex = 0) {
        if (!this.state.currentText) return;

        const textToSpeak = this.state.currentText.substring(startIndex);
        if (!textToSpeak.trim()) return;

        this.state.utterance = new SpeechSynthesisUtterance(textToSpeak);
        this.state.utterance.lang = 'pt-BR';
        this.state.utterance.rate = parseFloat(this.ui.voiceSpeed.value);

        this.state.utterance.onboundary = (event) => {
            if (event.name === 'word') {
                this.state.currentCharIndex = startIndex + event.charIndex;
                const progress = (this.state.currentCharIndex / this.state.currentText.length) * 100;
                this.ui.audioProgress.value = progress;
            }
        };

        this.state.utterance.onstart = () => {
            this.state.isSpeaking = true;
            this.state.isPaused = false;
            document.getElementById('play-icon').classList.add('hidden');
            document.getElementById('pause-icon').classList.remove('hidden');
            this.announce("Lendo.");
        };

        this.state.utterance.onend = () => {
            if (!this.state.isPaused) {
                this.state.isSpeaking = false;
                this.state.currentCharIndex = 0;
                this.ui.audioProgress.value = 0;
                document.getElementById('play-icon').classList.remove('hidden');
                document.getElementById('pause-icon').classList.add('hidden');
            }
        };

        this.state.synth.speak(this.state.utterance);
    },

    pauseSpeech() {
        this.state.synth.cancel();
        this.state.isSpeaking = false;
        this.state.isPaused = true;
        document.getElementById('play-icon').classList.remove('hidden');
        document.getElementById('pause-icon').classList.add('hidden');
        this.announce("Pausado.");
    },

    stopSpeech() {
        this.state.synth.cancel();
        this.state.isSpeaking = false;
        this.state.isPaused = false;
        document.getElementById('play-icon').classList.remove('hidden');
        document.getElementById('pause-icon').classList.add('hidden');
    },

    toggleSpeech() {
        if (this.state.isSpeaking) {
            this.pauseSpeech();
        } else if (this.state.isPaused) {
            this.startSpeech(this.state.currentCharIndex);
        } else {
            this.startSpeech(0);
        }
    },

    // 6. DOCX Export
    async exportToDocx(useAbnt = false) {
        if (!this.state.currentText) return;

        // Validation for ABNT & Premium
        if (useAbnt) {
            if (!this.state.abnt.isPremium) {
                this.togglePaymentModal(true);
                return;
            }
            // Sync current values from UI inputs
            this.state.abnt.institution = this.ui.abntInputs.institution.value;
            this.state.abnt.author = this.ui.abntInputs.author.value;
            this.state.abnt.advisor = this.ui.abntInputs.advisor.value;
            this.state.abnt.title = this.ui.abntInputs.title.value;
            this.state.abnt.subtitle = this.ui.abntInputs.subtitle.value;
            this.state.abnt.nature = this.ui.abntInputs.nature.value;
            this.state.abnt.city = this.ui.abntInputs.city.value;
            this.state.abnt.year = this.ui.abntInputs.year.value;

            const missing = [];
            if (!this.state.abnt.title) missing.push("Título");
            if (!this.state.abnt.author) missing.push("Autor");
            if (!this.state.abnt.institution) missing.push("Instituição");

            if (missing.length > 0) {
                alert(`Para exportar com ABNT, preencha: ${missing.join(", ")}`);
                this.ui.abntCard.classList.remove('hidden');
                return;
            }
        }

        const btn = useAbnt ? this.ui.btnExportAbnt : this.ui.btnExport;
        const originalBtnText = btn.textContent;

        btn.textContent = "Gerando...";
        btn.disabled = true;

        try {
            const docxLib = window.docx;
            if (!docxLib) throw new Error("Biblioteca DOCX não carregada.");

            const alignment = docxLib.AlignmentType ? docxLib.AlignmentType.JUSTIFIED : "justified";
            const centerAlign = docxLib.AlignmentType ? docxLib.AlignmentType.CENTER : "center";

            // Structural Pages (Capa e Folha de Rosto)
            const structuralPages = [];
            const { abnt } = this.state;

            if (useAbnt && abnt.title && abnt.author) {
                const addSpacing = (twips) => new docxLib.Paragraph({ children: [new docxLib.TextRun("")], spacing: { before: twips } });

                // CAPA (Page 1)
                structuralPages.push(
                    new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.institution.toUpperCase(), bold: true, size: 28, font: "Arial" })], alignment: centerAlign }),
                    addSpacing(2000), // Push Author down
                    new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.author.toUpperCase(), bold: true, size: 24, font: "Arial" })], alignment: centerAlign }),
                    addSpacing(4000), // Push Title to Center
                    new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.title.toUpperCase(), bold: true, size: 36, font: "Arial" })], alignment: centerAlign }),
                    abnt.subtitle ? new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.subtitle, size: 24, font: "Arial" })], alignment: centerAlign, spacing: { before: 200 } }) : new docxLib.Paragraph({ children: [] }),
                    addSpacing(5000), // Calibrated to fit on single page
                    new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.city.toUpperCase(), bold: true, size: 24, font: "Arial" })], alignment: centerAlign }),
                    new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.year, bold: true, size: 24, font: "Arial" })], alignment: centerAlign }),
                    new docxLib.Paragraph({ children: [new docxLib.PageBreak()] }),

                    // FOLHA DE ROSTO (Page 2)
                    new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.author.toUpperCase(), bold: true, size: 24, font: "Arial" })], alignment: centerAlign }),
                    addSpacing(3500),
                    new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.title.toUpperCase(), bold: true, size: 36, font: "Arial" })], alignment: centerAlign }),
                    abnt.subtitle ? new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.subtitle, size: 24, font: "Arial" })], alignment: centerAlign, spacing: { before: 200 } }) : new docxLib.Paragraph({ children: [] }),
                    addSpacing(1500),
                    new docxLib.Paragraph({
                        children: [new docxLib.TextRun({
                            text: abnt.nature ? `${abnt.nature} apresentado à ${abnt.institution} como requisito para obtenção de grau.` : `Trabalho apresentado à ${abnt.institution} como requisito para obtenção de grau.`,
                            size: 20,
                            font: "Arial"
                        })],
                        indent: { left: 5670 },
                        alignment: alignment
                    }),
                    abnt.advisor ? new docxLib.Paragraph({
                        children: [new docxLib.TextRun({ text: `Orientador: ${abnt.advisor}`, size: 22, font: "Arial" })],
                        indent: { left: 5670 },
                        alignment: alignment,
                        spacing: { before: 400 }
                    }) : new docxLib.Paragraph({ children: [] }),
                    addSpacing(4500), // Calibrated for Folha de Rosto
                    new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.city.toUpperCase(), bold: true, size: 24, font: "Arial" })], alignment: centerAlign }),
                    new docxLib.Paragraph({ children: [new docxLib.TextRun({ text: abnt.year, bold: true, size: 24, font: "Arial" })], alignment: centerAlign }),
                    new docxLib.Paragraph({ children: [new docxLib.PageBreak()] })
                );
            }

            const paragraphs = this.state.currentText.split('\n')
                .map(line => {
                    const text = line.trim();
                    if (!text) return new docxLib.Paragraph({ children: [new docxLib.TextRun("")] });

                    const isHeading = useAbnt && text.length > 5 && text === text.toUpperCase() && !text.endsWith('.') && !text.includes('  ');

                    return new docxLib.Paragraph({
                        children: [new docxLib.TextRun({
                            text: text,
                            size: isHeading ? 28 : 24,
                            bold: isHeading,
                            font: "Arial"
                        })],
                        alignment: isHeading ? centerAlign : alignment,
                        spacing: { line: 360, after: 200, before: isHeading ? 400 : 0 },
                        indent: isHeading ? {} : (useAbnt ? { firstLine: 709 } : {})
                    });
                });

            const doc = new docxLib.Document({
                sections: [{
                    properties: {
                        page: {
                            size: {
                                width: 11906,
                                height: 16838
                            },
                            margin: useAbnt ? {
                                top: 1701,
                                left: 1701,
                                bottom: 1134,
                                right: 1134,
                            } : {
                                top: 1134, // Standard 2cm
                                left: 1134,
                                bottom: 1134,
                                right: 1134
                            },
                        },
                    },
                    children: [...structuralPages, ...paragraphs]
                }],
            });

            const blob = await docxLib.Packer.toBlob(doc);
            const fileName = `SightAI_${useAbnt ? 'ABNT' : 'DOCX'}_${Date.now()}.docx`;

            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.click();
            window.URL.revokeObjectURL(url);

            this.announce(useAbnt ? "Exportação ABNT concluída." : "Exportação DOCX concluída.");
        } catch (error) {
            console.error("Erro Export DOCX:", error);
            alert(`Erro na exportação: ${error.message}`);
        } finally {
            btn.textContent = originalBtnText;
            btn.disabled = false;
        }
    },

    async copyToClipboard() {
        if (!this.state.currentText) return;
        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(this.state.currentText);
            } else {
                const ta = document.createElement("textarea");
                ta.value = this.state.currentText;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            this.ui.btnCopy.textContent = "Copiado!";
            setTimeout(() => this.ui.btnCopy.textContent = "Copiar Texto", 2000);
        } catch (err) {
            console.error(err);
        }
    },

    generateAISummary() {
        this.announce("Gerando resumo...");
        const summary = "Resumo SightAI: Processamento concluído. O texto foi extraído e está pronto para edição ou exportação.";
        const ut = new SpeechSynthesisUtterance(summary);
        ut.lang = 'pt-BR';
        this.state.synth.speak(ut);
    },

    toggleContrast() {
        this.state.highContrast = !this.state.highContrast;
        document.body.classList.toggle('high-contrast');
    },

    toggleVoiceCommands() {
        this.state.voiceCommandActive = !this.state.voiceCommandActive;
        this.ui.btnVoiceCmd.classList.toggle('active');
        this.announce(this.state.voiceCommandActive ? "Comandos de voz ativados" : "Comandos de voz desativados");
    },

    switchSection(target) {
        Object.values(this.ui.sections).forEach(s => s.classList.add('hidden'));
        this.ui.sections[target].classList.remove('hidden');
    },

    updateStatus(percent, text) {
        this.ui.progress.style.width = `${percent}%`;
        this.ui.statusText.textContent = text;
    },

    showResults(text) {
        this.switchSection('results');
        this.ui.outputText.value = text;
        this.announce("Tudo pronto.");
    },

    announce(message) {
        const live = document.createElement('div');
        live.setAttribute('aria-live', 'polite');
        live.classList.add('hidden');
        live.textContent = message;
        document.body.appendChild(live);
        setTimeout(() => live.remove(), 3000);
    },

    resetApp() {
        this.state.currentText = "";
        this.state.currentCharIndex = 0;
        this.ui.audioProgress.value = 0;
        if (this.state.isSpeaking || this.state.isPaused) this.stopSpeech();
        this.ui.outputText.value = "";
        this.ui.fileInput.value = "";
        this.ui.progress.style.width = "0%";
        this.switchSection('upload');
    }
};

SightAI.init();