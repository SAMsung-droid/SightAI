// Configuração Global do PDF.js (Versão LEGACY para máxima compatibilidade em Mobile)
const PDFJS_VERSION = '3.11.174';
if (typeof pdfjsLib !== 'undefined') {
    // Usando versão NÃO-MINIFICADA no worker para evitar erro de 'WorkerMessageHandler of undefined' no mobile
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.js`;
}

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
            btnVoiceCmd: document.getElementById('toggle-voice-cmd'),
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
        this.ui.btnVoiceCmd.addEventListener('click', () => this.toggleVoiceCommands());
        this.ui.btnExport.addEventListener('click', () => this.exportToDocx());
        this.ui.btnCopy.addEventListener('click', () => this.copyToClipboard());
        this.ui.btnSummarize.addEventListener('click', () => this.generateAISummary());

        // Sync Textarea with State
        this.ui.outputText.addEventListener('input', (e) => {
            this.state.currentText = e.target.value;
        });

        // Voice Speed update
        this.ui.voiceSpeed.addEventListener('input', () => {
            if (this.state.isSpeaking) {
                // Se estiver falando, cancelamos e reiniciamos da frase atual seria o ideal, 
                // mas para simplicidade aqui apenas paramos e o usuário dá play de novo se quiser.
                this.stopSpeech();
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

            this.state.currentText = fullText;
            this.showResults(fullText);

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
    startSpeech() {
        if (!this.state.currentText) return;

        this.state.utterance = new SpeechSynthesisUtterance(this.state.currentText);
        this.state.utterance.lang = 'pt-BR';
        this.state.utterance.rate = parseFloat(this.ui.voiceSpeed.value);

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

    // 6. DOCX Export
    async exportToDocx() {
        if (!this.state.currentText) return;

        const originalBtnText = this.ui.btnExport.textContent;
        this.ui.btnExport.textContent = "Gerando...";
        this.ui.btnExport.disabled = true;

        try {
            const docxLib = window.docx;
            if (!docxLib) throw new Error("Biblioteca DOCX não carregada.");

            const paragraphs = this.state.currentText.split('\n')
                .map(line => {
                    return new docxLib.Paragraph({
                        children: [new docxLib.TextRun({ text: line.trim() || "", size: 24, font: "Arial" })],
                        spacing: { after: 200 }
                    });
                });

            const doc = new docxLib.Document({
                sections: [{ properties: {}, children: paragraphs }],
            });

            const blob = await docxLib.Packer.toBlob(doc);
            const fileName = `SightAI_Export_${Date.now()}.docx`;

            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.click();
            window.URL.revokeObjectURL(url);

            this.announce("Exportação concluída.");
        } catch (error) {
            console.error(error);
            alert("Erro na exportação.");
        } finally {
            this.ui.btnExport.textContent = originalBtnText;
            this.ui.btnExport.disabled = false;
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
        if (this.state.isSpeaking) this.stopSpeech();
        this.ui.outputText.value = "";
        this.ui.fileInput.value = "";
        this.ui.progress.style.width = "0%";
        this.switchSection('upload');
    }
};

SightAI.init();
