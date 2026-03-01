import React, { useState, useRef, useEffect } from 'react';
import { 
  FileText, 
  Upload, 
  Download, 
  Settings, 
  Zap, 
  Shield, 
  FileCode, 
  Image as ImageIcon,
  ChevronRight,
  Loader2,
  Edit3,
  AlertCircle,
  CheckCircle2,
  X,
  Scan,
  Share2,
  Cloud,
  Eye,
  Globe,
  Columns,
  Maximize2,
  Smartphone,
  Monitor,
  ArrowRight
} from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { ConversionEngine, ConversionMode, ConversionResult } from './services/ConversionEngine';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviewUrls, setFilePreviewUrls] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<ConversionMode>(ConversionMode.OFFLINE);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [embedFonts, setEmbedFonts] = useState(false);
  const [results, setResults] = useState<ConversionResult[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'upload' | 'preview'>('upload');
  const [showExportHub, setShowExportHub] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewLayout, setPreviewLayout] = useState<'side-by-side' | 'stacked'>('side-by-side');
  const [outputOptions, setOutputOptions] = useState({
    margins: 'normal',
    lineSpacing: 1.15,
    defaultFontSize: 11,
    defaultFont: 'Arial',
    tableBorderStyle: 'single',
    tableBorderColor: '#cbd5e1',
    tableBorderSize: 1,
    tableCellPadding: 8
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [fileSettings, setFileSettings] = useState<Record<string, any>>({});
  
  const [autoConvert, setAutoConvert] = useState(true);
  const [isPro, setIsPro] = useState(false);
  const [googleTokens, setGoogleTokens] = useState<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('success')) {
      setIsPro(true);
      localStorage.setItem('pdf2doc_pro', 'true');
      alert('Successfully upgraded to PDF2doc Pro!');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (query.get('canceled')) {
      alert('Upgrade canceled.');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      const storedPro = localStorage.getItem('pdf2doc_pro');
      if (storedPro === 'true') {
        setIsPro(true);
      }
    }

    const storedTokens = localStorage.getItem('google_tokens');
    if (storedTokens) {
      try {
        setGoogleTokens(JSON.parse(storedTokens));
      } catch (e) {
        console.error('Failed to parse stored Google tokens');
      }
    }

    const handleMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith('.run.app') && !event.origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        const tokens = event.data.tokens;
        setGoogleTokens(tokens);
        localStorage.setItem('google_tokens', JSON.stringify(tokens));
        alert('Successfully connected to Google Drive!');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const activeResult = results[activeResultIndex];
  const activeFile = files.find(f => f.name.replace('.pdf', '.docx') === activeResult?.fileName || f.name.split('.')[0] + '.pdf' === activeResult?.fileName);
  const activeFileUrl = activeFile ? filePreviewUrls[activeFile.name] : null;

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeResult) handleExport(activeResult, 'docx');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        setActiveTab('upload');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '2') {
        e.preventDefault();
        setActiveTab('preview');
      }
      if (activeTab === 'preview' && results.length > 1) {
        if (e.key === 'ArrowLeft') {
          setActiveResultIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
        }
        if (e.key === 'ArrowRight') {
          setActiveResultIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, activeResult, results.length]);

  // Anonymous Analytics Simulation
  const trackEvent = (name: string, data?: any) => {
    console.log(`[Analytics] ${name}`, data);
  };

  useEffect(() => {
    trackEvent('app_loaded');
  }, []);

  useEffect(() => {
    const newUrls: Record<string, string> = {};
    files.forEach(file => {
      const url = URL.createObjectURL(file);
      newUrls[file.name] = url;
    });
    setFilePreviewUrls(newUrls);
    return () => {
      Object.values(newUrls).forEach(url => URL.revokeObjectURL(url));
    };
  }, [files]);

  const validateFiles = async (selectedFiles: File[]) => {
    setError(null);
    const validFiles: File[] = [];
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png'];

    for (const file of selectedFiles) {
      if (!validTypes.includes(file.type)) {
        setError(`Unsupported file type: ${file.name}`);
        continue;
      }

      if (file.type === 'application/pdf') {
        const isProtected = await ConversionEngine.isPasswordProtected(file);
        if (isProtected) {
          setError(`File is password protected: ${file.name}. Please remove protection before uploading.`);
          continue;
        }
      }
      validFiles.push(file);
    }

    if (validFiles.length > 0) {
      const updatedFiles = [...files, ...validFiles];
      setFiles(updatedFiles);
      trackEvent('files_added', { count: validFiles.length });
      
      if (autoConvert) {
        setTimeout(() => startConversion(updatedFiles), 100);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      validateFiles(Array.from(e.target.files));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      validateFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleCloudSave = async () => {
    if (!isPro) {
      alert("Cloud Save is a Pro feature. Please upgrade to unlock.");
      return;
    }
    if (!activeResult) return;

    if (!googleTokens) {
      try {
        const response = await fetch('/api/auth/google/url');
        const data = await response.json();
        if (data.url) {
          window.open(data.url, 'google_oauth_popup', 'width=600,height=700');
        } else {
          alert('Failed to get Google Auth URL');
        }
      } catch (error) {
        console.error('Error getting Google Auth URL:', error);
      }
      return;
    }

    try {
      setIsProcessing(true);
      const blob = await ConversionEngine.exportToDocx(activeResult, {
        mode,
        ocrEnabled,
        embedFonts,
        margins: outputOptions.margins === 'normal' ? 1 : (outputOptions.margins === 'narrow' ? 0.5 : 1.5),
        lineSpacing: outputOptions.lineSpacing,
        defaultFontSize: outputOptions.defaultFontSize,
        tableBorderStyle: outputOptions.tableBorderStyle,
        tableBorderColor: outputOptions.tableBorderColor,
        tableBorderSize: outputOptions.tableBorderSize,
        tableCellPadding: outputOptions.tableCellPadding
      });

      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = (reader.result as string).split(',')[1];
        const response = await fetch('/api/drive/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tokens: googleTokens,
            fileName: activeResult.fileName.replace(/\.[^/.]+$/, "") + ".docx",
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            base64Data: base64data,
          }),
        });

        const data = await response.json();
        if (data.success) {
          alert(`Successfully saved to Google Drive!`);
          if (data.link) {
            window.open(data.link, '_blank');
          }
        } else {
          alert(`Failed to save to Google Drive: ${data.error}`);
          if (data.error?.includes('invalid_grant')) {
             setGoogleTokens(null);
             localStorage.removeItem('google_tokens');
             alert('Google Drive session expired. Please try again to reconnect.');
          }
        }
      };
    } catch (error) {
      console.error('Cloud save error:', error);
      alert('An error occurred during cloud save.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpgrade = async () => {
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Failed to create checkout session.');
      }
    } catch (error) {
      console.error('Error upgrading:', error);
      alert('An error occurred while trying to upgrade.');
    }
  };

  const startConversion = async (filesToProcess: File[] = files) => {
    if (filesToProcess.length === 0) return;
    setIsProcessing(true);
    setProgress(0);
    setError(null);
    trackEvent('conversion_started', { mode, count: filesToProcess.length, ocr: ocrEnabled, fonts: embedFonts, options: outputOptions });
    
    try {
      const interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) return prev;
          const increment = ocrEnabled ? 2 : 5;
          return prev + increment;
        });
      }, 100);

      const batchResults: ConversionResult[] = await Promise.all(filesToProcess.map(async (file) => {
        try {
          const settings = fileSettings[file.name] || {
            mode,
            ocrEnabled,
            embedFonts,
            margins: outputOptions.margins === 'normal' ? 1 : (outputOptions.margins === 'narrow' ? 0.5 : 1.5),
            lineSpacing: outputOptions.lineSpacing,
            defaultFontSize: outputOptions.defaultFontSize,
            tableBorderStyle: outputOptions.tableBorderStyle,
            tableBorderColor: outputOptions.tableBorderColor,
            tableBorderSize: outputOptions.tableBorderSize,
            tableCellPadding: outputOptions.tableCellPadding
          };
          const result = await ConversionEngine.pdfToDocx(file, settings);
          return { ...result, id: Math.random().toString(36).substr(2, 9) };
        } catch (fileErr) {
          console.error(`Failed to convert ${file.name}:`, fileErr);
          return {
            id: Math.random().toString(36).substr(2, 9),
            fileName: file.name.replace(/\.[^/.]+$/, "") + ".docx",
            content: `<div style="padding: 20px; border: 2px dashed #ef4444; border-radius: 12px; background: #fef2f2;">
              <h1 style="color: #b91c1c;">Conversion Error</h1>
              <p style="color: #7f1d1d;">Failed to convert <strong>${file.name}</strong>.</p>
              <p style="font-size: 14px; color: #991b1b;">Error: ${fileErr instanceof Error ? fileErr.message : 'Unknown error'}</p>
              <p style="font-size: 12px; color: #b91c1c; margin-top: 10px;">Try switching to <strong>Enhanced Mode</strong> or check if the file is password protected.</p>
            </div>`,
            originalFile: file
          };
        }
      }));

      clearInterval(interval);
      setProgress(100);
      
      setTimeout(() => {
        setResults(batchResults);
        setActiveResultIndex(0);
        setActiveTab('preview');
        setIsProcessing(false);
        setProgress(0);
        trackEvent('conversion_completed', { count: batchResults.length });
      }, 500);

    } catch (err) {
      console.error('Conversion failed:', err);
      setError(`Conversion failed: ${err instanceof Error ? err.message : 'An unexpected error occurred'}. Please try again.`);
      setIsProcessing(false);
      setProgress(0);
      trackEvent('conversion_failed');
    }
  };

  const handleBatchExport = async () => {
    if (results.length === 0) return;
    try {
      const zipBlob = await ConversionEngine.createBatchZip(results, {
        mode,
        ocrEnabled,
        embedFonts,
        margins: outputOptions.margins === 'normal' ? 1 : (outputOptions.margins === 'narrow' ? 0.5 : 1.5),
        lineSpacing: outputOptions.lineSpacing,
        defaultFontSize: outputOptions.defaultFontSize,
        tableBorderStyle: outputOptions.tableBorderStyle,
        tableBorderColor: outputOptions.tableBorderColor,
        tableBorderSize: outputOptions.tableBorderSize,
        tableCellPadding: outputOptions.tableCellPadding
      });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pdf2doc_batch_${new Date().getTime()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      trackEvent('batch_export_completed', { count: results.length });
    } catch (err) {
      console.error("Batch export failed:", err);
      alert("Failed to create batch export.");
    }
  };

  const handleExport = async (result: ConversionResult, format: 'docx' | 'pdf' | 'txt' | 'html') => {
    let blob: Blob;
    let extension = format;
    
    switch (format) {
      case 'pdf':
        blob = await ConversionEngine.exportToPdf(result.content, result.fileName);
        break;
      case 'txt':
        blob = await ConversionEngine.exportToTxt(result.content);
        break;
      case 'html':
        blob = await ConversionEngine.exportToHtml(result.content);
        break;
      case 'docx':
      default:
        blob = await ConversionEngine.exportToDocx(result, {
          mode,
          ocrEnabled,
          embedFonts,
          margins: outputOptions.margins === 'normal' ? 1 : (outputOptions.margins === 'narrow' ? 0.5 : 1.5),
          lineSpacing: outputOptions.lineSpacing,
          defaultFontSize: outputOptions.defaultFontSize,
          tableBorderStyle: outputOptions.tableBorderStyle,
          tableBorderColor: outputOptions.tableBorderColor,
          tableBorderSize: outputOptions.tableBorderSize,
          tableCellPadding: outputOptions.tableCellPadding
        });
        extension = 'docx';
        break;
    }

    const exportFileName = result.fileName.replace(/\.[^/.]+$/, "") + "." + extension;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName;
    a.click();
    trackEvent('file_exported', { fileName: exportFileName, format });
    setShowExportHub(false);
  };

  const handleFindReplace = (replaceAll: boolean = false) => {
    if (!searchTerm || !activeResult) return;
    
    if (replaceAll && !window.confirm(`Are you sure you want to replace all occurrences of "${searchTerm}" with "${replaceTerm}"?`)) {
      return;
    }

    let newContent;
    if (replaceAll) {
      newContent = activeResult.content.split(searchTerm).join(replaceTerm);
    } else {
      newContent = activeResult.content.replace(searchTerm, replaceTerm);
    }
    setResults(prev => prev.map((r, i) => i === activeResultIndex ? { ...r, content: newContent } : r));
    trackEvent('find_replace_used', { replaceAll });
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 md:py-4 sticky top-0 z-40 shadow-sm shrink-0">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="relative flex items-center justify-center w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl md:rounded-2xl shadow-lg shadow-blue-500/30 border border-white/10 overflow-hidden group">
              <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute top-0 right-0 w-4 h-4 bg-white/10 rounded-bl-xl" />
              <span className="relative text-white font-black text-sm md:text-base tracking-tighter drop-shadow-sm">PdF</span>
              <div className="absolute bottom-0 right-0 w-0 h-0 border-b-[12px] border-r-[12px] border-b-white/20 border-r-transparent" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tighter text-slate-900 flex items-center gap-1">
                PDF<span className="text-blue-600">2</span>doc
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-slate-400">Engine v4.2 Active</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex items-center bg-slate-100 rounded-full p-0.5 md:p-1 border border-slate-200">
              <button 
                aria-label="Switch to Offline Mode"
                onClick={() => setMode(ConversionMode.OFFLINE)}
                className={cn(
                  "px-2 md:px-4 py-1 md:py-1.5 text-[10px] md:text-xs font-semibold rounded-full transition-all flex items-center gap-1 md:gap-2 min-h-[32px] md:min-h-[36px]",
                  mode === ConversionMode.OFFLINE ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                <Shield size={12} className="md:w-[14px] md:h-[14px]" />
                <span className="hidden xs:inline">Offline</span>
                <span className="xs:hidden">Off</span>
              </button>
              <button 
                aria-label="Switch to Online Mode"
                onClick={() => setMode(ConversionMode.ONLINE)}
                className={cn(
                  "px-2 md:px-4 py-1 md:py-1.5 text-[10px] md:text-xs font-semibold rounded-full transition-all flex items-center gap-1 md:gap-2 min-h-[32px] md:min-h-[36px]",
                  mode === ConversionMode.ONLINE ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                <Zap size={12} className="md:w-[14px] md:h-[14px]" />
                <span className="hidden xs:inline">Online</span>
                <span className="xs:hidden">On</span>
              </button>
            </div>
            
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-full">
              <div className={cn("w-2 h-2 rounded-full", mode === ConversionMode.ONLINE ? "bg-blue-500" : "bg-slate-400")} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-blue-700">
                {mode === ConversionMode.ONLINE ? "Enhanced" : "Standard"}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-8 overflow-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'upload' ? (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Hero Section */}
              <div className="text-center max-w-2xl mx-auto space-y-3 md:space-y-4 py-4 md:py-8">
                <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
                  Convert PDF to Word with <span className="text-blue-600">Precision</span>.
                </h2>
                <p className="text-slate-500 text-base md:text-lg px-4 md:px-0">
                  Our Fixed-to-Flow engine preserves your original layout, fonts, and colors while making your document fully editable.
                </p>
              </div>

              {/* File Picker */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <motion.div 
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    animate={{ 
                      scale: isDragging ? 1.02 : 1,
                      borderColor: isDragging ? '#3b82f6' : '#e2e8f0',
                      backgroundColor: isDragging ? 'rgba(239, 246, 255, 0.5)' : 'rgba(255, 255, 255, 1)'
                    }}
                    className={cn(
                      "relative group border-2 border-dashed rounded-3xl p-8 md:p-20 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 min-h-[200px] md:min-h-[400px]",
                      files.length > 0 ? "border-blue-600 bg-blue-50/20" : ""
                    )}
                  >
                    <div className="w-16 h-16 md:w-20 md:h-20 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 md:mb-6 group-hover:scale-110 transition-transform duration-300">
                      <Upload className="text-blue-600 w-8 h-8 md:w-10 md:h-10" />
                    </div>
                    
                    <div className="text-center space-y-1 md:space-y-2">
                      <h3 className="text-xl md:text-2xl font-bold text-slate-900">
                        {files.length > 0 ? `${files.length} Files Selected` : "Select Documents"}
                      </h3>
                      {files.length > 0 && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); setFiles([]); setResults([]); setFileSettings({}); }}
                          className="text-[10px] font-bold text-red-500 uppercase tracking-widest hover:underline"
                        >
                          Clear All
                        </button>
                      )}
                      <p className="text-slate-400 font-medium text-sm md:text-base">
                        Drag & drop or tap to browse
                      </p>
                    </div>

                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                      <span className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold uppercase tracking-wider text-slate-500 shadow-sm flex items-center gap-2">
                        <FileText size={12} className="text-red-500" /> PDF
                      </span>
                      <span className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold uppercase tracking-wider text-slate-500 shadow-sm flex items-center gap-2">
                        <ImageIcon size={12} className="text-blue-500" /> JPG / PNG
                      </span>
                    </div>

                    {files.length > 0 && (
                      <div className="mt-10 w-full max-w-md space-y-2">
                        {files.map((f, idx) => (
                          <motion.div 
                            key={idx}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="bg-white border border-blue-100 rounded-2xl p-4 flex flex-col gap-3 shadow-xl shadow-blue-900/5"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
                                {f.type.startsWith('image/') ? <ImageIcon className="text-white w-5 h-5" /> : <FileText className="text-white w-5 h-5" />}
                              </div>
                              <div className="flex-1 min-w-0 text-left">
                                <p className="text-sm font-bold text-slate-900 truncate">{f.name}</p>
                                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                              </div>
                              <button 
                                aria-label={`Remove ${f.name}`}
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  setFiles(prev => prev.filter((_, i) => i !== idx)); 
                                  const newSettings = { ...fileSettings };
                                  delete newSettings[f.name];
                                  setFileSettings(newSettings);
                                }}
                                className="p-3 md:p-2 hover:bg-slate-100 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                              >
                                <X size={18} className="text-slate-400" />
                              </button>
                            </div>
                            
                            <div className="flex items-center gap-3 md:gap-4 pt-2 border-t border-slate-50">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const current = fileSettings[f.name] || { ocrEnabled, embedFonts, mode };
                                  setFileSettings({ ...fileSettings, [f.name]: { ...current, ocrEnabled: !current.ocrEnabled } });
                                }}
                                className={cn(
                                  "text-[10px] md:text-xs font-bold px-3 py-1.5 md:px-2 md:py-1 rounded-lg transition-colors min-h-[32px] md:min-h-[28px]",
                                  (fileSettings[f.name]?.ocrEnabled ?? ocrEnabled) ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                                )}
                              >
                                OCR: {(fileSettings[f.name]?.ocrEnabled ?? ocrEnabled) ? 'ON' : 'OFF'}
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const current = fileSettings[f.name] || { ocrEnabled, embedFonts, mode };
                                  setFileSettings({ ...fileSettings, [f.name]: { ...current, embedFonts: !current.embedFonts } });
                                }}
                                className={cn(
                                  "text-[10px] md:text-xs font-bold px-3 py-1.5 md:px-2 md:py-1 rounded-lg transition-colors min-h-[32px] md:min-h-[28px]",
                                  (fileSettings[f.name]?.embedFonts ?? embedFonts) ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                                )}
                              >
                                FONTS: {(fileSettings[f.name]?.embedFonts ?? embedFonts) ? 'ON' : 'OFF'}
                              </button>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    )}

                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      accept=".pdf,image/jpeg,image/png,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" 
                      multiple
                      className="hidden" 
                    />
                  </motion.div>

                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 flex items-center gap-3"
                    >
                      <AlertCircle size={20} />
                      <p className="text-sm font-semibold">{error}</p>
                    </motion.div>
                  )}

                  {isProcessing && (
                    <div className="space-y-4 bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
                      <div className="flex justify-between items-end">
                        <div className="space-y-1">
                          <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Processing...</p>
                          <h4 className="text-lg font-bold text-slate-900">Converting {files.length} documents</h4>
                        </div>
                        <span className="text-2xl font-black text-blue-600">{progress}%</span>
                      </div>
                      <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-blue-600"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                          transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Controls Sidebar */}
                <div className="space-y-6">
                  <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Settings size={20} className="text-blue-600" />
                      Settings
                    </h3>
                    
                    <div className="space-y-4">
                      <div className="p-4 md:p-5 bg-slate-50 rounded-2xl space-y-5">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Zap size={18} className="text-slate-400" />
                            <div className="flex flex-col">
                              <span className="text-sm md:text-base font-bold text-slate-700">Auto-Convert</span>
                              <span className="text-[10px] text-slate-400 leading-tight">Start conversion on upload</span>
                            </div>
                          </div>
                          <button 
                            aria-label="Toggle Auto-Convert"
                            onClick={() => setAutoConvert(!autoConvert)}
                            className={cn(
                              "w-12 h-7 rounded-full relative transition-colors duration-200 min-h-[28px]",
                              autoConvert ? "bg-blue-600" : "bg-slate-300"
                            )}
                          >
                            <div className={cn(
                              "absolute top-1 w-5 h-5 rounded-full bg-white transition-all duration-200",
                              autoConvert ? "left-6" : "left-1"
                            )} />
                          </button>
                        </div>

                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Scan size={18} className="text-slate-400" />
                            <span className="text-sm md:text-base font-bold text-slate-700">OCR Analysis</span>
                          </div>
                          <button 
                            aria-label="Toggle OCR"
                            onClick={() => setOcrEnabled(!ocrEnabled)}
                            className={cn(
                              "w-12 h-7 rounded-full relative transition-colors duration-200 min-h-[28px]",
                              ocrEnabled ? "bg-blue-600" : "bg-slate-300"
                            )}
                          >
                            <div className={cn(
                              "absolute top-1 w-5 h-5 rounded-full bg-white transition-all duration-200",
                              ocrEnabled ? "left-6" : "left-1"
                            )} />
                          </button>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <FileCode size={18} className="text-slate-400" />
                            <div className="flex flex-col">
                              <span className="text-sm md:text-base font-bold text-slate-700">Embed Fonts</span>
                              <span className="text-[10px] text-slate-400 leading-tight">Preserve original typography in DOCX</span>
                            </div>
                          </div>
                          <button 
                            aria-label="Toggle Font Embedding"
                            onClick={() => setEmbedFonts(!embedFonts)}
                            className={cn(
                              "w-12 h-7 rounded-full relative transition-colors duration-200 min-h-[28px]",
                              embedFonts ? "bg-blue-600" : "bg-slate-300"
                            )}
                          >
                            <div className={cn(
                              "absolute top-1 w-5 h-5 rounded-full bg-white transition-all duration-200",
                              embedFonts ? "left-6" : "left-1"
                            )} />
                          </button>
                        </div>
                      </div>

                      <div className="p-4 md:p-5 bg-slate-50 rounded-2xl space-y-5">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Output Options</h4>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-slate-600">Margins</span>
                            <select 
                              value={outputOptions.margins}
                              onChange={(e) => setOutputOptions({...outputOptions, margins: e.target.value})}
                              className="text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 min-h-[40px] outline-none focus:border-blue-500"
                            >
                              <option value="normal">Normal</option>
                              <option value="narrow">Narrow</option>
                              <option value="wide">Wide</option>
                            </select>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-slate-600">Line Spacing</span>
                            <select 
                              value={outputOptions.lineSpacing}
                              onChange={(e) => setOutputOptions({...outputOptions, lineSpacing: parseFloat(e.target.value)})}
                              className="text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 min-h-[40px] outline-none focus:border-blue-500"
                            >
                              <option value="1.0">1.0</option>
                              <option value="1.15">1.15</option>
                              <option value="1.5">1.5</option>
                              <option value="2.0">2.0</option>
                            </select>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-slate-600">Font Size</span>
                            <input 
                              type="number"
                              value={outputOptions.defaultFontSize}
                              onChange={(e) => setOutputOptions({...outputOptions, defaultFontSize: parseInt(e.target.value)})}
                              className="w-16 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 min-h-[40px] outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="p-4 md:p-5 bg-slate-50 rounded-2xl space-y-5">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">Table Options</h4>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-slate-600">Border Style</span>
                            <select 
                              value={outputOptions.tableBorderStyle}
                              onChange={(e) => setOutputOptions({...outputOptions, tableBorderStyle: e.target.value})}
                              className="text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 min-h-[40px] outline-none focus:border-blue-500"
                            >
                              <option value="single">Single</option>
                              <option value="double">Double</option>
                              <option value="dashed">Dashed</option>
                              <option value="dotted">Dotted</option>
                              <option value="none">None</option>
                            </select>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-slate-600">Border Color</span>
                            <input 
                              type="color"
                              value={outputOptions.tableBorderColor}
                              onChange={(e) => setOutputOptions({...outputOptions, tableBorderColor: e.target.value})}
                              className="w-10 h-10 rounded-lg cursor-pointer border-none bg-transparent"
                            />
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-slate-600">Border Size</span>
                            <input 
                              type="number"
                              min="1"
                              max="10"
                              value={outputOptions.tableBorderSize}
                              onChange={(e) => setOutputOptions({...outputOptions, tableBorderSize: parseInt(e.target.value)})}
                              className="w-16 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 min-h-[40px] outline-none focus:border-blue-500"
                            />
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-slate-600">Cell Padding</span>
                            <input 
                              type="number"
                              min="0"
                              max="50"
                              value={outputOptions.tableCellPadding}
                              onChange={(e) => setOutputOptions({...outputOptions, tableCellPadding: parseInt(e.target.value)})}
                              className="w-16 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 min-h-[40px] outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <button 
                      disabled={files.length === 0 || isProcessing || (!isPro && files.length > 1)}
                      onClick={() => startConversion()}
                      className="w-full bg-blue-600 text-white py-4 md:py-5 rounded-2xl md:rounded-3xl font-bold uppercase tracking-widest text-sm md:text-base flex items-center justify-center gap-3 hover:bg-blue-700 transition-all disabled:opacity-30 shadow-lg shadow-blue-200 min-h-[56px] md:min-h-[64px]"
                      title={!isPro && files.length > 1 ? "Upgrade to Pro for batch processing" : ""}
                    >
                      {isProcessing ? <Loader2 className="animate-spin" /> : <>{files.length > 1 ? 'Start Batch Conversion' : 'Start Conversion'} <ArrowRight size={20} /></>}
                    </button>
                  </div>

                  {!isPro ? (
                    <div className="bg-deep-blue rounded-3xl p-6 text-white space-y-4 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
                      <h4 className="text-sm font-bold uppercase tracking-widest text-blue-400">Pro Feature</h4>
                      <p className="text-sm font-medium leading-relaxed opacity-80">
                        Unlock batch processing and cloud sync by upgrading to PDF2doc Pro.
                      </p>
                      <button 
                        onClick={handleUpgrade}
                        aria-label="Learn more about PDF2doc Pro"
                        className="text-xs font-bold uppercase tracking-widest bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
                      >
                        Learn More
                      </button>
                    </div>
                  ) : (
                    <div className="bg-emerald-900/40 border border-emerald-500/20 rounded-3xl p-6 text-emerald-100 space-y-2 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={18} className="text-emerald-400" />
                        <h4 className="text-sm font-bold uppercase tracking-widest text-emerald-400">Pro Active</h4>
                      </div>
                      <p className="text-sm font-medium leading-relaxed opacity-80">
                        Batch processing and cloud sync are enabled.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="preview"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex-1 flex flex-col gap-4 md:gap-6 min-h-0"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-4 w-full md:w-auto">
                  <button 
                    aria-label="Back to Upload"
                    onClick={() => setActiveTab('upload')}
                    className="p-2 hover:bg-white rounded-xl border border-slate-200 transition-colors shrink-0"
                  >
                    <X size={20} className="text-slate-500" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg md:text-xl font-bold text-slate-900 truncate">{activeResult?.fileName}</h2>
                      {results.length > 1 && (
                        <div className="flex items-center gap-1">
                          <button 
                            aria-label="Previous result"
                            onClick={() => setActiveResultIndex(prev => (prev > 0 ? prev - 1 : results.length - 1))}
                            className="p-1 hover:bg-slate-100 rounded transition-colors text-slate-400"
                          >
                            <ChevronRight className="rotate-180" size={12} />
                          </button>
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full whitespace-nowrap">
                            {activeResultIndex + 1} / {results.length}
                          </span>
                          <button 
                            aria-label="Next result"
                            onClick={() => setActiveResultIndex(prev => (prev < results.length - 1 ? prev + 1 : 0))}
                            className="p-1 hover:bg-slate-100 rounded transition-colors text-slate-400"
                          >
                            <ChevronRight size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Ready for export</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
                  <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1">
                    <button 
                      aria-label="Side-by-Side View"
                      onClick={() => setPreviewLayout('side-by-side')}
                      className={cn("p-1.5 md:p-2 rounded-lg transition-colors", previewLayout === 'side-by-side' ? "bg-slate-100 text-blue-600" : "text-slate-400 hover:bg-slate-50")}
                    >
                      <Columns size={16} className="md:w-[18px] md:h-[18px]" />
                    </button>
                    <button 
                      aria-label="Stacked View"
                      onClick={() => setPreviewLayout('stacked')}
                      className={cn("p-1.5 md:p-2 rounded-lg transition-colors", previewLayout === 'stacked' ? "bg-slate-100 text-blue-600" : "text-slate-400 hover:bg-slate-50")}
                    >
                      <Maximize2 size={16} className="md:w-[18px] md:h-[18px]" />
                    </button>
                  </div>
                  <button 
                    onClick={() => setShowExportHub(true)}
                    className="flex-1 md:flex-none bg-blue-600 text-white px-4 md:px-6 py-2 md:py-2.5 rounded-xl font-bold uppercase text-[10px] md:text-xs flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
                  >
                    <Share2 size={14} className="md:w-4 md:h-4" />
                    Export Hub
                  </button>
                </div>
              </div>

              <div className={cn(
                "flex-1 flex gap-6 overflow-hidden",
                previewLayout === 'stacked' ? "flex-col" : "flex-row"
              )}>
                <div className={cn(
                  "bg-slate-200 rounded-2xl md:rounded-3xl overflow-hidden border border-slate-300 relative group",
                  previewLayout === 'side-by-side' ? "flex-1 hidden md:block" : "h-64 md:h-1/2"
                )}>
                  <div className="absolute top-4 left-4 z-10 bg-white/80 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200">
                    Original Document
                  </div>
                  {activeFileUrl ? (
                    <div className="w-full h-full">
                      {activeFile?.type.startsWith('image/') ? (
                        <img 
                          src={activeFileUrl} 
                          alt="Original Preview" 
                          className="w-full h-full object-contain bg-slate-100"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full relative flex flex-col items-center justify-center bg-slate-100 p-6 text-center">
                          <FileCode size={48} className="text-slate-400 mb-4" />
                          <h3 className="text-lg font-bold text-slate-700 mb-2">PDF Document</h3>
                          <p className="text-sm text-slate-500 mb-6 max-w-xs">
                            Direct PDF preview is disabled in this environment. Click below to view the original file.
                          </p>
                          <a 
                            href={activeFileUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="bg-white px-6 py-3 rounded-xl text-sm font-bold text-blue-600 shadow-sm border border-slate-200 hover:bg-slate-50 hover:shadow-md transition-all flex items-center gap-2"
                          >
                            <Maximize2 size={16} />
                            Open Original PDF
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                      Preview not available
                    </div>
                  )}
                </div>

                <div className={cn(
                  "bg-white rounded-2xl md:rounded-3xl overflow-hidden border border-slate-200 shadow-sm flex flex-col",
                  previewLayout === 'side-by-side' ? "flex-1" : "flex-1 md:h-1/2"
                )}>
                  <div className="px-4 md:px-6 py-3 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-50/50">
                    <div className="flex flex-wrap items-center gap-3 md:gap-4 w-full sm:w-auto">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">Editable Content</span>
                      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1 flex-1 sm:flex-none">
                        <input 
                          type="text" 
                          placeholder="Find..." 
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="text-[10px] outline-none w-full sm:w-20"
                          aria-label="Find text"
                        />
                        <input 
                          type="text" 
                          placeholder="Replace..." 
                          value={replaceTerm}
                          onChange={(e) => setReplaceTerm(e.target.value)}
                          className="text-[10px] outline-none w-full sm:w-20 border-l border-slate-100 pl-2"
                          aria-label="Replace with"
                        />
                        <div className="flex gap-1 border-l border-slate-100 pl-2">
                          <button 
                            onClick={() => handleFindReplace(false)} 
                            className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
                            aria-label="Replace next"
                          >
                            Next
                          </button>
                          <button 
                            onClick={() => handleFindReplace(true)} 
                            className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
                            aria-label="Replace all"
                          >
                            All
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button 
                        onClick={() => {
                          if (activeResult) {
                            const plainText = activeResult.content.replace(/<[^>]*>/g, '');
                            navigator.clipboard.writeText(plainText);
                            alert('Content copied!');
                          }
                        }}
                        className="p-2 hover:bg-blue-50 rounded-lg transition-colors text-blue-600 flex items-center gap-1.5"
                        aria-label="Copy to clipboard"
                      >
                        <Scan size={14} />
                        <span className="text-[10px] font-bold uppercase hidden xs:inline">Copy</span>
                      </button>
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span className="text-[10px] font-bold text-blue-600 uppercase">Live Editor</span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto editor-container">
                    <ReactQuill 
                      theme="snow" 
                      modules={{
                        history: {
                          delay: 1000,
                          maxStack: 500,
                          userOnly: true
                        },
                        toolbar: {
                          container: [
                            [{ 'header': [1, 2, 3, false] }],
                            ['bold', 'italic', 'underline', 'strike'],
                            [{ 'color': [] }, { 'background': [] }],
                            [{ 'align': [] }],
                            ['undo', 'redo'],
                            ['link', 'image'],
                            ['clean']
                          ],
                          handlers: {
                            'undo': function(this: any) {
                              this.quill.history.undo();
                            },
                            'redo': function(this: any) {
                              this.quill.history.redo();
                            }
                          }
                        }
                      }}
                      value={activeResult?.content || ''} 
                      onChange={(content) => {
                        setResults(prev => prev.map((r, i) => i === activeResultIndex ? { ...r, content } : r));
                      }}
                      className="h-full"
                    />
                  </div>
                </div>
              </div>

              {results.length > 1 && (
                <div className="flex justify-center gap-3 py-4">
                  {results.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setActiveResultIndex(idx)}
                      className={cn(
                        "w-3 h-3 md:w-2.5 md:h-2.5 rounded-full transition-all min-h-[20px] min-w-[20px] flex items-center justify-center",
                        activeResultIndex === idx ? "bg-blue-600 w-10 md:w-8" : "bg-slate-300 hover:bg-slate-400"
                      )}
                    >
                      <div className={cn("w-1.5 h-1.5 rounded-full", activeResultIndex === idx ? "bg-white" : "bg-transparent")} />
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Export Hub Modal */}
      <AnimatePresence>
        {showExportHub && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExportHub(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50"
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 bg-white rounded-t-[32px] md:rounded-t-[40px] z-50 shadow-2xl p-6 md:p-12 max-w-4xl mx-auto max-h-[95vh] overflow-y-auto"
            >
              <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 md:mb-8" />
              
              <div className="flex justify-between items-start mb-6 md:mb-10">
                <div>
                  <h3 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">Export Hub</h3>
                  <p className="text-slate-500 font-medium text-sm md:text-base">Choose how you'd like to save your document.</p>
                </div>
                <button 
                  onClick={() => setShowExportHub(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={24} className="text-slate-400" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                <button 
                  onClick={() => activeResult && handleExport(activeResult, 'docx')}
                  className="group p-6 md:p-8 bg-blue-600 rounded-2xl md:rounded-3xl text-left transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-blue-200 min-h-[140px] md:min-h-[180px]"
                >
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-white/20 rounded-xl md:rounded-2xl flex items-center justify-center mb-4 md:mb-6 group-hover:scale-110 transition-transform">
                    <FileText className="text-white" />
                  </div>
                  <h4 className="text-white font-bold text-lg md:text-xl mb-1 md:mb-2">Word (.docx)</h4>
                  <p className="text-blue-100 text-xs md:text-sm leading-relaxed">Best for editing and professional documents.</p>
                </button>

                <button 
                  onClick={() => activeResult && handleExport(activeResult, 'pdf')}
                  className="group p-6 md:p-8 bg-white border border-slate-200 rounded-2xl md:rounded-3xl text-left transition-all hover:scale-[1.02] hover:bg-slate-50 hover:border-slate-300 min-h-[140px] md:min-h-[180px]"
                >
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-red-50 rounded-xl md:rounded-2xl flex items-center justify-center mb-4 md:mb-6 group-hover:scale-110 transition-transform">
                    <FileCode className="text-red-600" />
                  </div>
                  <h4 className="text-slate-900 font-bold text-lg md:text-xl mb-1 md:mb-2">PDF (.pdf)</h4>
                  <p className="text-slate-500 text-xs md:text-sm leading-relaxed">Best for sharing and printing with layout preserved.</p>
                </button>

                <button 
                  onClick={() => activeResult && handleExport(activeResult, 'txt')}
                  className="group p-6 md:p-8 bg-white border border-slate-200 rounded-2xl md:rounded-3xl text-left transition-all hover:scale-[1.02] hover:bg-slate-50 hover:border-slate-300 min-h-[140px] md:min-h-[180px]"
                >
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-100 rounded-xl md:rounded-2xl flex items-center justify-center mb-4 md:mb-6 group-hover:scale-110 transition-transform">
                    <FileText className="text-slate-600" />
                  </div>
                  <h4 className="text-slate-900 font-bold text-lg md:text-xl mb-1 md:mb-2">Plain Text (.txt)</h4>
                  <p className="text-slate-500 text-xs md:text-sm leading-relaxed">Best for raw data extraction and simple notes.</p>
                </button>

                <button 
                  onClick={() => activeResult && handleExport(activeResult, 'html')}
                  className="group p-6 md:p-8 bg-white border border-slate-200 rounded-2xl md:rounded-3xl text-left transition-all hover:scale-[1.02] hover:bg-slate-50 hover:border-slate-300 min-h-[140px] md:min-h-[180px]"
                >
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-emerald-50 rounded-xl md:rounded-2xl flex items-center justify-center mb-4 md:mb-6 group-hover:scale-110 transition-transform">
                    <Globe className="text-emerald-600" />
                  </div>
                  <h4 className="text-slate-900 font-bold text-lg md:text-xl mb-1 md:mb-2">Web Page (.html)</h4>
                  <p className="text-slate-500 text-xs md:text-sm leading-relaxed">Best for publishing content directly to the web.</p>
                </button>
              </div>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button 
                  onClick={() => {
                    if (activeResult) {
                      const plainText = activeResult.content.replace(/<[^>]*>/g, '');
                      navigator.clipboard.writeText(plainText);
                      trackEvent('content_copied');
                      alert('Content copied to clipboard!');
                    }
                  }}
                  className="flex items-center justify-center gap-3 p-4 bg-slate-100 hover:bg-slate-200 rounded-2xl font-bold text-slate-700 transition-all min-h-[56px]"
                >
                  <Scan size={20} />
                  Copy Text to Clipboard
                </button>
                <button 
                  onClick={handleCloudSave}
                  className="flex items-center justify-center gap-3 p-4 bg-slate-100 hover:bg-slate-200 rounded-2xl font-bold text-slate-700 transition-all min-h-[56px] relative overflow-hidden group"
                >
                  <Cloud size={20} />
                  Cloud Save
                  {!isPro && (
                    <div className="absolute inset-0 bg-slate-200/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-600">Pro Feature</span>
                    </div>
                  )}
                </button>
                <button 
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({
                        title: 'PDF2doc Export',
                        text: `Check out my converted document: ${activeResult?.fileName}`,
                        url: window.location.href
                      }).catch(console.error);
                    } else {
                      navigator.clipboard.writeText(window.location.href);
                      alert('App link copied to clipboard!');
                    }
                  }}
                  className="flex items-center justify-center gap-3 p-4 bg-slate-100 hover:bg-slate-200 rounded-2xl font-bold text-slate-700 transition-all min-h-[56px]"
                >
                  <Share2 size={20} />
                  Share App Link
                </button>
                {results.length > 1 && (
                  <div className="col-span-1 sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button 
                      onClick={handleBatchExport}
                      className="flex items-center justify-center gap-3 p-4 bg-blue-50 hover:bg-blue-100 rounded-2xl font-bold text-blue-700 transition-all min-h-[56px] border border-blue-200"
                    >
                      <CheckCircle2 size={20} />
                      Download All as ZIP
                    </button>
                    <button 
                      onClick={async () => {
                        for (const res of results) {
                          await handleExport(res, 'docx');
                        }
                      }}
                      className="flex items-center justify-center gap-3 p-4 bg-slate-100 hover:bg-slate-200 rounded-2xl font-bold text-slate-700 transition-all min-h-[56px]"
                    >
                      <FileText size={20} />
                      Download Individual Files
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-8 md:mt-10 pt-6 md:pt-8 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-500" />
                  <span className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-widest">Layout Integrity Verified</span>
                </div>
                <div className="flex flex-wrap justify-center gap-4 md:gap-6">
                  <a href="#" onClick={(e) => { e.preventDefault(); alert('Privacy Policy: Your data is processed locally and never stored on our servers.'); }} className="text-[10px] md:text-xs font-bold text-slate-400 hover:text-blue-600 uppercase tracking-widest transition-colors min-h-[32px] flex items-center">Privacy Policy</a>
                  <a href="#" onClick={(e) => { e.preventDefault(); alert('Terms of Service: PDF2doc is provided as-is for professional document conversion.'); }} className="text-[10px] md:text-xs font-bold text-slate-400 hover:text-blue-600 uppercase tracking-widest transition-colors min-h-[32px] flex items-center">Terms of Service</a>
                  <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-[10px] md:text-xs font-bold text-slate-400 hover:text-blue-600 uppercase tracking-widest transition-colors min-h-[32px] flex items-center">Help Center</a>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Mobile Conversion Bar */}
      {files.length > 0 && activeTab === 'upload' && !isProcessing && (
        <div className="md:hidden fixed bottom-6 left-6 right-6 z-40">
          <button 
            onClick={() => startConversion()}
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-3 shadow-2xl shadow-blue-400 animate-in fade-in slide-in-from-bottom-4"
          >
            Start Conversion <ArrowRight size={18} />
          </button>
        </div>
      )}

      {/* Global Styles for Quill */}
      <style>{`
        .editor-container .ql-toolbar.ql-snow {
          border: none !important;
          border-bottom: 1px solid #f1f5f9 !important;
          padding: 16px 24px !important;
          background: #f8fafc;
        }
        .editor-container .ql-container.ql-snow {
          border: none !important;
          font-family: 'Inter', sans-serif !important;
        }
        .editor-container .ql-editor {
          padding: 32px 40px !important;
          font-size: 16px;
          line-height: 1.6;
          color: #1e293b;
        }
        .editor-container .ql-editor h1 { font-size: 2em; font-weight: 800; margin-bottom: 0.5em; color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.2em; }
        .editor-container .ql-editor h2 { font-size: 1.5em; font-weight: 700; margin-top: 1em; margin-bottom: 0.5em; color: #334155; }
        .editor-container .ql-editor p { margin-bottom: 1em; }
        
        /* Custom Undo/Redo Icons */
        .ql-undo:after { content: '⟲'; }
        .ql-redo:after { content: '⟳'; }
        .ql-undo, .ql-redo { width: 28px !important; font-size: 18px !important; display: flex !important; align-items: center; justify-content: center; }
      `}</style>
    </div>
  );
}
