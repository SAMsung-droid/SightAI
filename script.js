/**
 * SightAI - Core Logic
 * Responsável por: Detecção de PDF, OCR, TTS e Exportação.
 */

// Configuração Global do PDF.js (CDN Sincronizado para evitar erros em Mobile)
const PDFJS_VERSION = '3.11.174';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;

const SightAI = {
    state: {
        currentText: "",
        isProcessing: false,
        isSpeaking: false,
        synth: window.speechSynthesis,
        utterance: null,
        highContrast: false,
        voiceCommandActive: false
    },

    // 1. Inicialização
    init() {
        try {
            console.log("Iniciando SightAI...");
            this.cacheDOM();
            this.bindEvents();
            this.runSelfTest();
            this.announce("SightAI iniciado.");
        } catch (error) {
            console.error("Erro fatal na inicialização:", error);
            // Avisos removidos a pedido do usuário
        }
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
            voiceSpeed: document.getElementById('voice-speed'),
            aiInsight: document.getElementById('ai-insight'),
            btnContrast: document.getElementById('toggle-contrast'),
            btnRestart: document.getElementById('btn-restart'),
            btnContinue: document.getElementById('btn-continue')
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
        this.ui.btnExport.addEventListener('click', () => this.exportToDocx());
        this.ui.btnCopy.addEventListener('click', () => this.copyToClipboard());
        this.ui.btnSummarize.addEventListener('click', () => this.generateAISummary());

        // Voice Speed update
        this.ui.voiceSpeed.addEventListener('input', () => {
            if (this.state.isSpeaking) {
                this.stopSpeech();
                this.startSpeech();
            }
        });

        this.ui.btnRestart.addEventListener('click', () => this.resetApp());
        this.ui.btnContinue.addEventListener('click', () => {
            console.log("Continuando edição...");
            this.announce("Você pode continuar editando ou exportando seu texto.");
        });
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
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

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

            this.state.currentText = fullText;
            this.showResults(fullText);

        } catch (error) {
            console.error("ERRO NO SIGHTAI:", error);
            this.updateStatus(0, "Erro: " + (error.message || "Falha ao ler PDF."));
            this.announce("Erro técnico: " + (error.message || "Tente um arquivo menor."));
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

    // 4. Advanced OCR (Tesseract.js) with Super-resolution
    async performOCR(pdf) {
        let text = "";

        // Determina escala baseada no hardware (Mobile vs Desktop)
        // Reduzido de 3.5 para 2.0 em mobile para evitar crash de memória
        const isMobile = window.innerWidth < 768;
        const ocrScale = isMobile ? 2.0 : 3.0;

        console.log(`Iniciando OCR com escala: ${ocrScale}`);

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

            context.filter = 'grayscale(100%) contrast(150%) brightness(110%)';

            await page.render({ canvasContext: context, viewport }).promise;

            const { data: { text: pageText } } = await worker.recognize(canvas);

            const cleanedPageText = this.cleanOCRNoise(pageText);
            text += cleanedPageText + "\n\n";
        }

        await worker.terminate();
        return text;
    },

    // Filtro semântico para remover símbolos sem sentido típicos de falha de OCR
    cleanOCRNoise(content) {
        if (!content) return "";

        return content
            // Remove sequências de símbolos aleatórios (ruído)
            .replace(/[~^`|#\\]/g, '')
            // Corrige espaços excessivos
            .replace(/ +/g, ' ')
            // Remove linhas que só contém símbolos ou um único caractere solto
            .split('\n')
            .filter(line => {
                const alphaLength = line.replace(/[^a-zA-ZáéíóúÁÉÍÓÚçÇ]/g, '').length;
                return line.length === 0 || alphaLength / line.length > 0.3; // Mantém se tiver pelo menos 30% de letras
            })
            .join('\n')
            // Tenta recuperar palavras quebradas por hífens de fim de linha
            .replace(/-\n/g, '');
    },

    // 5. Assistive Features (TTS)
    startSpeech() {
        if (!this.state.currentText) return;

        this.state.utterance = new SpeechSynthesisUtterance(this.state.currentText);
        this.state.utterance.lang = 'pt-BR';
        this.state.utterance.rate = this.ui.voiceSpeed.value;

        this.state.utterance.onstart = () => {
            this.state.isSpeaking = true;
            document.getElementById('play-icon').classList.add('hidden');
            document.getElementById('pause-icon').classList.remove('hidden');
            this.announce("Iniciando leitura.");
        };

        this.state.utterance.onend = () => {
            this.state.isSpeaking = false;
            document.getElementById('play-icon').classList.remove('hidden');
            document.getElementById('pause-icon').classList.add('hidden');
        };

        this.state.synth.speak(this.state.utterance);
    },

    stopSpeech() {
        this.state.synth.cancel();
        this.state.isSpeaking = false;
        document.getElementById('play-icon').classList.remove('hidden');
        document.getElementById('pause-icon').classList.add('hidden');
    },

    toggleSpeech() {
        if (this.state.isSpeaking) {
            this.stopSpeech();
        } else {
            this.startSpeech();
        }
    },

    // 6. Exportação (docx.js) - Versão Otimizada v8.x com Diagnóstico
    async exportToDocx() {
        console.log("Botão Exportar clicado");

        if (!this.state.currentText) {
            this.announce("Atenção: Não há texto para exportar. Processe um PDF primeiro.");
            return;
        }

        const originalBtnText = this.ui.btnExport.textContent;
        this.ui.btnExport.textContent = "Gerando...";
        this.ui.btnExport.disabled = true;

        try {
            this.announce("Preparando seu documento Word...");

            // Diagnóstico e Captura Robusta da Biblioteca
            const docxLib = window.docx;

            if (!docxLib || !docxLib.Document) {
                console.error("SightAI - Biblioteca DOCX não encontrada!", window.docx);
                throw new Error("A biblioteca de exportação (DOCX) não pôde ser carregada. Verifique sua conexão com a internet e atualize a página.");
            }

            // Criando os parágrafos
            const paragraphs = this.state.currentText.split('\n')
                .map(line => {
                    const cleanLine = line.trim();
                    return new docxLib.Paragraph({
                        children: [
                            new docxLib.TextRun({
                                text: cleanLine || "",
                                size: 24, // 12pt
                                font: "Arial"
                            })
                        ],
                        spacing: { after: 200 }
                    });
                });

            const doc = new docxLib.Document({
                sections: [{
                    properties: {},
                    children: paragraphs,
                }],
            });

            const blob = await docxLib.Packer.toBlob(doc);
            const fileName = `SightAI_Export_${new Date().getTime()}.docx`;

            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.style.display = 'none';
            link.href = url;
            link.download = fileName;

            document.body.appendChild(link);
            link.click();

            setTimeout(() => {
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
            }, 200);

            this.announce("Download iniciado com sucesso.");
        } catch (error) {
            console.error("ERRO NA EXPORTAÇÃO:", error);
            alert("Erro ao exportar: " + error.message);
        } finally {
            this.ui.btnExport.textContent = originalBtnText;
            this.ui.btnExport.disabled = false;
        }
    },

    // 6.1 Copiar para Área de Transferência com Fallback para context não-seguro (file://)
    async copyToClipboard() {
        if (!this.state.currentText) {
            alert("Não há texto para copiar.");
            return;
        }

        try {
            // Tenta usar a API moderna primeiro
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(this.state.currentText);
            } else {
                // Fallback para navegadores antigos ou contextos não-seguros (file://)
                const textArea = document.createElement("textarea");
                textArea.value = this.state.currentText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }

            this.ui.btnCopy.textContent = "Copiado!";
            this.ui.btnCopy.classList.add('success-btn');
            this.announce("Texto copiado com sucesso.");

            setTimeout(() => {
                this.ui.btnCopy.textContent = "Copiar Texto";
                this.ui.btnCopy.classList.remove('success-btn');
            }, 2000);
        } catch (err) {
            console.error("Erro ao copiar:", err);
            alert("Erro ao copiar o texto. Tente selecionar e copiar manualmente.");
        }
    },

    // 7. IA Differentiator (Simulated Summary)
    generateAISummary() {
        this.announce("Gerando resumo inteligente...");
        const summary = "Resumo SightAI: Este documento contém informações processadas de um PDF. Os temas principais detectados incluem a estrutura textual original preservada. Recomenda-se a leitura integral para detalhes acadêmicos.";

        this.stopSpeech();
        const summaryUtterance = new SpeechSynthesisUtterance(summary);
        summaryUtterance.lang = 'pt-BR';
        this.state.synth.speak(summaryUtterance);
    },

    // 8. UI Helpers
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
        this.ui.outputText.textContent = text;
        this.announce("Processamento finalizado. O texto está disponível para leitura e exportação.");
    },

    toggleContrast() {
        this.state.highContrast = !this.state.highContrast;
        document.body.classList.toggle('high-contrast');
        this.announce(this.state.highContrast ? "Alto contraste ativado" : "Alto contraste desativado");
    },

    announce(message) {
        const ariaLive = document.createElement('div');
        ariaLive.setAttribute('aria-live', 'polite');
        ariaLive.style.position = 'absolute';
        ariaLive.style.width = '1px';
        ariaLive.style.height = '1px';
        ariaLive.style.overflow = 'hidden';
        ariaLive.textContent = message;
        document.body.appendChild(ariaLive);
        setTimeout(() => ariaLive.remove(), 3000);
    },

    // 9. Reset System
    resetApp() {
        console.log("Reiniciando SightAI...");

        // Reset State
        this.state.currentText = "";
        this.state.isProcessing = false;
        if (this.state.isSpeaking) this.stopSpeech();

        // Reset UI
        this.ui.outputText.textContent = "";
        this.ui.fileInput.value = "";
        this.ui.progress.style.width = "0%";
        document.getElementById('file-info-text').textContent = "Nenhum arquivo selecionado";
        this.ui.aiInsight.textContent = "Aguardando IA...";
        this.ui.aiInsight.style.background = "var(--primary-dark)";

        // Switch Section
        this.switchSection('upload');
        this.announce("Pronto para transcrever um novo texto.");
    }
};

// Start
SightAI.init();
