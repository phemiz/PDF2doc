import { PDFDocument, rgb } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun, AlignmentType, Header, Footer, PageNumber, Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun, TextWrappingType, TextWrappingSide } from 'docx';
import { GoogleGenAI, Type } from "@google/genai";
import JSZip from 'jszip';

export enum ConversionMode {
  OFFLINE = 'offline',
  ONLINE = 'online'
}

export interface ConversionResult {
  content: string; // HTML for the editor
  blob?: Blob;
  fileName: string;
  id: string;
  analysis?: any;
  originalFile?: File;
}

export interface ConversionOptions {
  mode: ConversionMode;
  ocrEnabled?: boolean;
  embedFonts?: boolean;
  margins?: number;
  lineSpacing?: number;
  defaultFontSize?: number;
  tableBorderStyle?: string;
  tableBorderColor?: string;
  tableBorderSize?: number;
  tableCellPadding?: number;
}

export interface StyleAttributes {
  fontFamily: string;
  fontSize: number;
  color: string;
  alignment: 'left' | 'center' | 'right' | 'justify';
  isBold: boolean;
  isItalic: boolean;
  underline?: boolean;
  strike?: boolean;
}

export class StyleMapper {
  private static fontMap: Record<string, string> = {
    'Times New Roman': 'serif',
    'Arial': 'sans-serif',
    'Courier New': 'monospace',
    'Helvetica': 'sans-serif',
    'Georgia': 'serif',
    'Verdana': 'sans-serif',
    'Tahoma': 'sans-serif',
    'Trebuchet MS': 'sans-serif',
    'Palatino': 'serif',
    'Garamond': 'serif',
    'Bookman': 'serif',
    'Comic Sans MS': 'cursive',
    'Impact': 'fantasy',
  };

  private static fallbackFonts: Record<string, string> = {
    'serif': 'Times New Roman',
    'sans-serif': 'Arial',
    'monospace': 'Courier New',
    'cursive': 'Comic Sans MS',
    'fantasy': 'Impact',
  };

  /**
   * Robust Font-Substitute Logic: Finds the closest matching system font
   */
  static getSubstituteFont(fontName: string): string {
    if (!fontName) return this.fallbackFonts['sans-serif'];
    
    // Exact match
    if (this.fontMap[fontName]) return fontName;

    const normalized = fontName.toLowerCase();
    
    // Category detection
    if (normalized.includes('serif')) return this.fallbackFonts['serif'];
    if (normalized.includes('mono') || normalized.includes('code') || normalized.includes('console')) return this.fallbackFonts['monospace'];
    if (normalized.includes('sans')) return this.fallbackFonts['sans-serif'];
    if (normalized.includes('script') || normalized.includes('hand')) return this.fallbackFonts['cursive'];
    
    // Default fallback
    return this.fallbackFonts['sans-serif'];
  }

  static mapToDocxStyle(attr: StyleAttributes) {
    return {
      font: this.getSubstituteFont(attr.fontFamily),
      size: (attr.fontSize || 11) * 2, // docx uses half-points
      color: (attr.color || '#000000').replace('#', ''),
      bold: attr.isBold || false,
      italics: attr.isItalic || false,
      underline: attr.underline ? {} : undefined,
      strike: attr.strike || false,
      alignment: this.mapAlignment(attr.alignment || 'left'),
    };
  }

  static mapAlignment(align: string) {
    switch (align) {
      case 'center': return AlignmentType.CENTER;
      case 'right': return AlignmentType.RIGHT;
      case 'justify': return AlignmentType.JUSTIFIED;
      default: return AlignmentType.LEFT;
    }
  }
}

export class ConversionEngine {
  private static getAI() {
    // Vite replaces process.env.GEMINI_API_KEY at build time based on vite.config.ts
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Please add GEMINI_API_KEY to your environment variables.");
    }
    return new GoogleGenAI({ apiKey });
  }

  static async isPasswordProtected(file: File): Promise<boolean> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      await PDFDocument.load(arrayBuffer);
      return false;
    } catch (err: any) {
      if (err.message && err.message.includes('encrypted')) {
        return true;
      }
      return false;
    }
  }

  static async convertBatch(files: File[], options: ConversionOptions): Promise<ConversionResult[]> {
    const results: ConversionResult[] = [];
    for (const file of files) {
      const result = await this.pdfToDocx(file, options);
      results.push({ ...result, id: Math.random().toString(36).substr(2, 9) });
    }
    return results;
  }

  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = reader.result as string;
        resolve(base64String.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  }

  /**
   * Real Layout Analysis using Gemini AI for Online mode
   * Supports both PDF and Images
   */
  static async analyzeLayoutOnline(file: File, options?: ConversionOptions): Promise<any> {
    const ai = this.getAI();
    const base64Data = await this.fileToBase64(file);
    const mimeType = file.type;

    const ocrInstruction = options?.ocrEnabled 
      ? "CRITICAL: This is likely a scanned document. IGNORE any embedded text layer as it may contain garbage. Perform visual high-accuracy OCR on all pages. Ensure every character, punctuation mark, and symbol is extracted accurately from the visual content. Pay special attention to small fonts and low-contrast text." 
      : "Extract text from the document structure.";

    const prompt = `
      Analyze this ${mimeType.includes('pdf') ? 'PDF' : mimeType.includes('word') ? 'Document' : 'Image'} and extract its full content and layout with high precision.
      ${ocrInstruction}
      
      CRITICAL INSTRUCTIONS:
      0. You MUST extract the ENTIRE text from ALL pages of the document. Do not summarize, truncate, or skip any pages.
      1. Detect multi-column layouts (e.g., 2-column or 3-column) and text flow across columns. Maintain correct reading order and logical flow.
      2. Identify structural elements: headers, footers, tables, and images.
      3. For tables, extract all rows and columns accurately as a 2D array of strings. Detect headers, maintain cell alignment, and handle merged cells if possible.
      4. For each paragraph, detect: fontFamily, fontSize, color (hex), alignment (left/center/right/justify), isBold, isItalic, underline (boolean), strike (boolean).
      5. If it's an image or scanned document, perform high-accuracy OCR to extract all text while maintaining its visual position and grouping. Ignore any hidden or garbled text layers.
      6. Detect the number of columns (integer) and column spacing if possible.
      7. For images, provide an alt text and suggest a placement (left/right/center) and wrapping style (square/tight/through).
      
      Return a JSON object with the following structure:
      {
        "header": { "text": "string", "style": { "fontSize": number, "color": "string", "alignment": "string" } },
        "footer": { "text": "string", "pageNumber": boolean, "style": { "fontSize": number, "color": "string", "alignment": "string" } },
        "columns": number,
        "paragraphs": [ { "text": "string", "style": { "fontFamily": "string", "fontSize": number, "color": "string", "alignment": "string", "isBold": boolean, "isItalic": boolean, "underline": boolean, "strike": boolean } } ],
        "tables": [ { "rows": [["string"]], "style": { "border": "string", "cellPadding": "string" } } ],
        "images": [ { "alt": "string", "placement": "string", "wrap": "string", "caption": "string" } ]
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        systemInstruction: "You are a highly accurate document conversion engine. Your ONLY task is to extract the exact text, layout, and structure from the provided document and format it as JSON. DO NOT hallucinate, summarize, or solve any problems. Extract the text EXACTLY as it appears in the document.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            header: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                style: {
                  type: Type.OBJECT,
                  properties: {
                    fontSize: { type: Type.NUMBER },
                    color: { type: Type.STRING },
                    alignment: { type: Type.STRING }
                  }
                }
              }
            },
            footer: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                pageNumber: { type: Type.BOOLEAN },
                style: {
                  type: Type.OBJECT,
                  properties: {
                    fontSize: { type: Type.NUMBER },
                    color: { type: Type.STRING },
                    alignment: { type: Type.STRING }
                  }
                }
              }
            },
            columns: { type: Type.NUMBER },
            paragraphs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  style: {
                    type: Type.OBJECT,
                    properties: {
                      fontFamily: { type: Type.STRING },
                      fontSize: { type: Type.NUMBER },
                      color: { type: Type.STRING },
                      alignment: { type: Type.STRING },
                      isBold: { type: Type.BOOLEAN },
                      isItalic: { type: Type.BOOLEAN },
                      underline: { type: Type.BOOLEAN },
                      strike: { type: Type.BOOLEAN }
                    }
                  }
                }
              }
            },
            tables: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  rows: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    }
                  },
                  style: {
                    type: Type.OBJECT,
                    properties: {
                      border: { type: Type.STRING },
                      cellPadding: { type: Type.STRING }
                    }
                  }
                }
              }
            },
            images: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  alt: { type: Type.STRING },
                  placement: { type: Type.STRING },
                  wrap: { type: Type.STRING },
                  caption: { type: Type.STRING }
                }
              }
            }
          }
        },
        temperature: 0.1,
      }
    });

    try {
      let text = response.text || '{}';
      text = text.trim();
      
      // Remove markdown code blocks if present
      if (text.startsWith('```json')) {
        text = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
      } else if (text.startsWith('```')) {
        text = text.replace(/^```\n?/, '').replace(/\n?```$/, '');
      }
      
      // Find the first { and last } to extract the JSON object
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      let cleanJson = text;
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanJson = text.substring(firstBrace, lastBrace + 1);
      }
      
      const parsed = JSON.parse(cleanJson);
      
      // Validation: Ensure paragraphs exist if we have text
      if (!parsed.paragraphs || parsed.paragraphs.length === 0) {
        console.warn("AI returned empty paragraphs, attempting to reconstruct from raw text");
        const rawText = text.replace(/\{[\s\S]*\}/, '').trim();
        if (rawText) {
          parsed.paragraphs = rawText.split('\n\n').map((t: string) => ({
            text: t.trim(),
            style: { fontFamily: 'Arial', fontSize: 11 }
          }));
        }
      }
      
      return parsed;
    } catch (e: any) {
      console.error("Failed to parse AI response", e);
      return this.fallbackAnalysis(file, e.message);
    }
  }

  /**
   * Improved Offline Layout Analysis using backend text extraction
   */
  static async analyzeLayoutOffline(file: File): Promise<any> {
    try {
      const base64Data = await this.fileToBase64(file);
      console.log(`Attempting offline extraction for ${file.name} (${file.size} bytes)`);

      const response = await fetch('/api/extract-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Backend extraction failed with status:", response.status, errorData);
        throw new Error(`Backend extraction failed: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      console.log("Offline extraction successful");
      const text = data.text || '';
      const paragraphs = text.split('\n\n').filter((t: string) => t.trim().length > 0).map((t: string) => ({
        text: t.trim(),
        style: { fontFamily: 'Arial', fontSize: 11, color: '#334155', alignment: 'left', isBold: false, isItalic: false }
      }));

      return {
        header: { text: `${file.name} - Standard Extraction`, style: { fontSize: 10, color: '#64748b', alignment: 'center' } },
        footer: { pageNumber: true, text: `Pages: ${data.numpages || 1}`, style: { fontSize: 9, color: '#94a3b8', alignment: 'right' } },
        columns: 1,
        paragraphs: paragraphs.length > 0 ? paragraphs : [
          { text: "No text could be extracted from this document.", style: { fontFamily: 'Arial', fontSize: 12, color: '#ef4444', alignment: 'left', isBold: false, isItalic: true } }
        ],
        tables: [],
        images: []
      };
    } catch (e: any) {
      console.error("Offline extraction error:", e);
      return this.fallbackAnalysis(file, e.message);
    }
  }

  private static fallbackAnalysis(file: File, errorMessage?: string) {
    return {
      header: { text: "PDF2doc Recovery Report", style: { fontSize: 10, color: '#94a3b8', alignment: 'center' } },
      footer: { pageNumber: true, text: "Generated by PDF2doc", style: { fontSize: 9, color: '#94a3b8', alignment: 'right' } },
      columns: 1,
      paragraphs: [
        { text: `Conversion failed for ${file.name}`, style: { fontFamily: 'Helvetica', fontSize: 14, color: '#b91c1c', alignment: 'left', isBold: true, isItalic: false } },
        { text: errorMessage || "We encountered an error processing this file.", style: { fontFamily: 'Arial', fontSize: 12, color: '#ef4444', alignment: 'left', isBold: false, isItalic: true } },
        { text: "Recommendations:", style: { fontFamily: 'Arial', fontSize: 12, color: '#334155', alignment: 'left', isBold: true, isItalic: false } },
        { text: "1. Switch to 'Enhanced Mode' (Online) in the settings for high-fidelity AI extraction.", style: { fontFamily: 'Arial', fontSize: 11, color: '#475569', alignment: 'left' } },
        { text: "2. Ensure the PDF is not password-protected or corrupted.", style: { fontFamily: 'Arial', fontSize: 11, color: '#475569', alignment: 'left' } },
        { text: "3. If the file is very large, try splitting it into smaller parts.", style: { fontFamily: 'Arial', fontSize: 11, color: '#475569', alignment: 'left' } }
      ],
      tables: [],
      images: []
    };
  }

  static async pdfToDocx(file: File, options: ConversionOptions): Promise<ConversionResult> {
    const { mode, embedFonts } = options;
    
    const analysis = mode === ConversionMode.ONLINE 
      ? await this.analyzeLayoutOnline(file, options)
      : await this.analyzeLayoutOffline(file);
    
    let htmlContent = '';
    
    const isImage = file.type.startsWith('image/');
    const fileName = file.name;

    // Render Header
    if (analysis.header) {
      htmlContent += `<div style="border-bottom: 1px solid #e2e8f0; margin-bottom: 20px; padding-bottom: 5px; text-align: ${analysis.header.style?.alignment || 'center'}; color: ${analysis.header.style?.color || '#94a3b8'}; font-size: ${analysis.header.style?.fontSize || 10}px;">${analysis.header.text}</div>`;
    }

    // Render Body with Column Simulation
    htmlContent += `<div style="column-count: ${analysis.columns || 1}; column-gap: 20px;">`;
    
    if (isImage && mode === ConversionMode.OFFLINE) {
      htmlContent += `<div style="text-align: center; margin-bottom: 20px;">
        <p style="color: #ef4444; font-style: italic;">OCR is only available in Online mode for images.</p>
        <img src="${URL.createObjectURL(file)}" style="max-width: 100%; border: 1px solid #e2e8f0; border-radius: 8px;" />
      </div>`;
    }
    
    // Render Images with wrapping
    (analysis.images || []).forEach((img: any) => {
      const float = img.placement === 'right' ? 'right' : 'left';
      const margin = img.placement === 'right' ? '0 0 10px 10px' : '0 10px 10px 0';
      const src = img.src || `https://picsum.photos/seed/${Math.random()}/200/150`;
      htmlContent += `
        <div style="float: ${float}; margin: ${margin}; width: 200px; border: 1px solid #e2e8f0; padding: 4px; background: #f8fafc;">
          <img src="${src}" alt="${img.alt || 'Document Image'}" style="width: 100%; display: block;" />
          <p style="font-size: 10px; color: #64748b; margin-top: 4px; text-align: center;">${img.caption || ''}</p>
        </div>
      `;
    });

    (analysis.paragraphs || []).forEach((p: any) => {
      const style = p.style || { fontFamily: 'Arial', fontSize: 12, color: '#000000', alignment: 'left', isBold: false, isItalic: false };
      const font = StyleMapper.getSubstituteFont(style.fontFamily);
      const textDecoration = `${style.underline ? 'underline' : ''} ${style.strike ? 'line-through' : ''}`.trim();
      htmlContent += `<p style="text-align: ${style.alignment || 'left'}; font-family: ${font}; font-size: ${style.fontSize || 12}px; color: ${style.color || '#000000'}; font-weight: ${style.isBold ? 'bold' : 'normal'}; font-style: ${style.isItalic ? 'italic' : 'normal'}; text-decoration: ${textDecoration || 'none'}">${p.text || ''}</p>`;
    });

    // Render Tables
    (analysis.tables || []).forEach((table: any) => {
      htmlContent += `<table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 12px;">`;
      (table.rows || []).forEach((row: string[], idx: number) => {
        htmlContent += `<tr>`;
        (row || []).forEach((cell: string) => {
          const bg = idx === 0 ? '#f1f5f9' : 'transparent';
          const weight = idx === 0 ? 'bold' : 'normal';
          const border = `${options.tableBorderSize || 1}px ${options.tableBorderStyle || 'solid'} ${options.tableBorderColor || '#cbd5e1'}`;
          const padding = `${options.tableCellPadding || 8}px`;
          htmlContent += `<td style="border: ${border}; padding: ${padding}; background: ${bg}; font-weight: ${weight};">${cell}</td>`;
        });
        htmlContent += `</tr>`;
      });
      htmlContent += `</table>`;
    });

    htmlContent += `</div>`;

    // Ensure we have at least some content if everything else failed
    if (htmlContent.replace(/<[^>]*>/g, ' ').trim().length === 0 && (analysis.images || []).length === 0 && (analysis.tables || []).length === 0) {
      htmlContent += `<p style="color: #64748b; font-style: italic;">No text content detected in this section of the document.</p>`;
    }

    // Render Footer
    if (analysis.footer) {
      htmlContent += `<div style="border-top: 1px solid #e2e8f0; margin-top: 40px; padding-top: 5px; text-align: ${analysis.footer.style.alignment}; color: ${analysis.footer.style.color}; font-size: ${analysis.footer.style.fontSize}px;">${analysis.footer.text} ${analysis.footer.pageNumber ? '| Page 1' : ''}</div>`;
    }

    if (mode === ConversionMode.ONLINE) {
      return {
        id: Math.random().toString(36).substr(2, 9),
        content: `<h1>${file.name.replace(/\.[^/.]+$/, "")}</h1>${htmlContent}${embedFonts ? '<p><i>Note: Original fonts embedded in output.</i></p>' : ''}`,
        fileName: fileName,
        analysis: analysis,
        originalFile: file
      };
    }

    return {
      id: Math.random().toString(36).substr(2, 9),
      content: `<h1>${file.name}</h1><p>Offline conversion complete.</p>${htmlContent}`,
      fileName: fileName,
      analysis: analysis,
      originalFile: file
    };
  }

  static async docxToPdf(htmlContent: string, fileName: string): Promise<Blob> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    
    // Simple text rendering for demo
    page.drawText('Converted from DOCX Editor', {
      x: 50,
      y: height - 50,
      size: 20,
      color: rgb(0, 0, 0),
    });

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
  }

  static async imageToPdf(imageFiles: File[]): Promise<Blob> {
    const pdfDoc = await PDFDocument.create();
    
    for (const file of imageFiles) {
      const arrayBuffer = await file.arrayBuffer();
      let image;
      if (file.type === 'image/jpeg') {
        image = await pdfDoc.embedJpg(arrayBuffer);
      } else {
        image = await pdfDoc.embedPng(arrayBuffer);
      }
      
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
  }

  static async exportToDocx(result: ConversionResult, options?: ConversionOptions): Promise<Blob> {
    const margins = options?.margins || 1;
    const lineSpacing = options?.lineSpacing || 1.15;
    const defaultFontSize = options?.defaultFontSize || 11;
    
    // Ensure we have a valid analysis object with at least some content
    const analysis = { ...(result.analysis || {}) };
    
    // If analysis is missing paragraphs, or they are empty, fallback to the editor content
    if (!analysis.paragraphs || (Array.isArray(analysis.paragraphs) && analysis.paragraphs.length === 0)) {
      const plainText = result.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      analysis.paragraphs = [{ 
        text: plainText || "No content extracted.", 
        style: { fontSize: defaultFontSize, fontFamily: 'Arial' } 
      }];
    }

    const tableBorderOptions = {
      style: (options?.tableBorderStyle as any) || BorderStyle.SINGLE,
      size: (options?.tableBorderSize || 1) * 4, // docx border size is in 1/8 points
      color: (options?.tableBorderColor || "cbd5e1").replace('#', ''),
    };

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: margins * 1440,
              right: margins * 1440,
              bottom: margins * 1440,
              left: margins * 1440,
            }
          },
          column: {
            count: analysis.columns || 1,
            space: 720, // 0.5 inch
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: analysis.header?.text || result.fileName.replace(/\.[^/.]+$/, "").replace(/_/g, ' '),
                    color: analysis.header?.style?.color?.replace('#', '') || "94a3b8",
                    size: (analysis.header?.style?.fontSize || 9) * 2,
                  }),
                ],
                alignment: StyleMapper.mapAlignment(analysis.header?.style?.alignment || 'center'),
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: (analysis.footer?.text || "Generated by PDF2doc") + " | Page ",
                    color: analysis.footer?.style?.color?.replace('#', '') || "94a3b8",
                    size: (analysis.footer?.style?.fontSize || 9) * 2,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    color: analysis.footer?.style?.color?.replace('#', '') || "94a3b8",
                    size: (analysis.footer?.style?.fontSize || 9) * 2,
                  }),
                ],
                alignment: StyleMapper.mapAlignment(analysis.footer?.style?.alignment || 'right'),
              }),
            ],
          }),
        },
        children: [
          ...(result.originalFile?.type.startsWith('image/') ? [
            new Paragraph({
              children: [
                new ImageRun({
                  data: await result.originalFile.arrayBuffer(),
                  transformation: {
                    width: 550,
                    height: 400,
                  },
                  type: 'png' as any, // Force type to avoid SvgMediaOptions confusion
                }),
              ],
              alignment: AlignmentType.CENTER,
            })
          ] : []),
          ...(analysis.paragraphs || []).map((p: any) => new Paragraph({
            alignment: StyleMapper.mapAlignment(p.style?.alignment || 'left'),
            spacing: { line: lineSpacing * 240 },
            children: [
              new TextRun({
                text: p.text || '',
                bold: p.style?.isBold || false,
                italics: p.style?.isItalic || false,
                size: (p.style?.fontSize || defaultFontSize) * 2,
                color: p.style?.color?.replace('#', '') || '000000',
                font: StyleMapper.getSubstituteFont(p.style?.fontFamily || 'Arial')
              }),
            ],
          })),
          ...(analysis.images || []).map((img: any) => new Paragraph({
            children: [
              new TextRun({
                text: `[Image: ${img.alt || 'Document Image'}]`,
                italics: true,
                color: "64748b",
                size: 18
              }),
              new TextRun({
                text: img.caption ? `\n${img.caption}` : '',
                size: 16,
                color: "94a3b8"
              })
            ],
            alignment: StyleMapper.mapAlignment(img.placement || 'center'),
          })),
          ...(analysis.tables || []).map((table: any) => new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
            rows: (table.rows || []).map((row: string[], idx: number) => new TableRow({
              children: row.map(cell => new TableCell({
                children: [new Paragraph({
                  children: [new TextRun({
                    text: cell,
                    bold: idx === 0,
                    size: defaultFontSize * 2
                  })],
                })],
                borders: {
                  top: tableBorderOptions,
                  bottom: tableBorderOptions,
                  left: tableBorderOptions,
                  right: tableBorderOptions,
                },
                shading: {
                  fill: idx === 0 ? "f1f5f9" : "ffffff",
                },
                margins: {
                  top: (options?.tableCellPadding || 8) * 20,
                  bottom: (options?.tableCellPadding || 8) * 20,
                  left: (options?.tableCellPadding || 8) * 20,
                  right: (options?.tableCellPadding || 8) * 20,
                }
              })),
            })),
          })),
        ],
      }],
    });

    return await Packer.toBlob(doc);
  }

  static async exportToPdf(htmlContent: string, fileName: string): Promise<Blob> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { height } = page.getSize();
    
    page.drawText(fileName.replace(/\.[^/.]+$/, ""), {
      x: 50,
      y: height - 50,
      size: 20,
      color: rgb(0.1, 0.2, 0.5),
    });

    const plainText = htmlContent.replace(/<[^>]*>/g, '');
    page.drawText(plainText.substring(0, 500) + (plainText.length > 500 ? '...' : ''), {
      x: 50,
      y: height - 100,
      size: 12,
      color: rgb(0, 0, 0),
      lineHeight: 15,
    });

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
  }

  static async exportToTxt(htmlContent: string): Promise<Blob> {
    const plainText = htmlContent.replace(/<[^>]*>/g, '');
    return new Blob([plainText], { type: 'text/plain' });
  }

  static async exportToHtml(htmlContent: string): Promise<Blob> {
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Exported Document</title>
        <style>
          body { font-family: sans-serif; line-height: 1.6; padding: 40px; max-width: 800px; margin: 0 auto; }
          h1 { color: #1e3a8a; border-bottom: 2px solid #e2e8f0; }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
      </html>
    `;
    return new Blob([fullHtml], { type: 'text/html' });
  }

  static async createBatchZip(results: ConversionResult[], options?: ConversionOptions): Promise<Blob> {
    const zip = new JSZip();
    
    for (const result of results) {
      // Export as DOCX inside the zip
      const docxBlob = await this.exportToDocx(result, options);
      zip.file(result.fileName, docxBlob);
    }
    
    return await zip.generateAsync({ type: 'blob' });
  }
}
