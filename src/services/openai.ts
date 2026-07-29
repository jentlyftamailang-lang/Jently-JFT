/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MappingResult, Phase, TujuanPembelajaran, LearningModel, ModulAjar, AlurTujuanPembelajaran, ATPItem, InfographicData, InfographicSection, InteractiveQuizQuestion } from "../types";

// Re-define Type enum locally for client-side use to avoid importing from @google/genai in the browser
export enum Type {
  TYPE_UNSPECIFIED = "TYPE_UNSPECIFIED",
  STRING = "STRING",
  NUMBER = "NUMBER",
  INTEGER = "INTEGER",
  BOOLEAN = "BOOLEAN",
  ARRAY = "ARRAY",
  OBJECT = "OBJECT",
  NULL = "NULL",
}


function normalizeClassLevel(input: string, selectedClasses: string[]): string {
  if (!input) return selectedClasses[0] || '1';
  
  let val = String(input).toUpperCase().trim();
  
  // Replace Roman Numerals first
  const romanMap: { [key: string]: string } = {
    'XII': '12',
    'XI': '11',
    'X': '10',
    'IX': '9',
    'VIII': '8',
    'VII': '7',
    'VI': '6',
    'IV': '4',
    'V': '5',
    'III': '3',
    'II': '2',
    'I': '1',
  };
  
  for (const [roman, num] of Object.entries(romanMap)) {
    const regex = new RegExp(`\\b${roman}\\b`, 'g');
    if (regex.test(val)) {
      val = val.replace(regex, num);
      break;
    }
  }
  
  // Extract only digits
  const digits = val.replace(/[^\d]/g, '');
  if (digits && selectedClasses.includes(digits)) {
    return digits;
  }
  
  // If digit didn't match directly, try to find any selected class that is contained in or matching
  const matched = selectedClasses.find(c => val.includes(c));
  if (matched) return matched;
  
  return selectedClasses[0] || '1';
}

function safeParseJson(text: string) {
  // 1. Pre-cleaning: Remove markdown code blocks and invisible characters
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  cleaned = cleaned.replace(/[\x00-\x1F\x7F-\x9F]/g, " "); // Remove control characters
  
  // 2. Direct Parse Attempt
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 3. Heavy cleanup: Collapse excessive whitespace
    const collapsed = cleaned.replace(/\s+/g, " ").trim();
    try {
      return JSON.parse(collapsed);
    } catch (e2) {
      // 4. Extraction & Reconstruction
      const firstBrace = collapsed.indexOf('{');
      const firstBracket = collapsed.indexOf('[');
      let startIdx = -1;
      let endChar = '';

      if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        startIdx = firstBrace;
        endChar = '}';
      } else if (firstBracket !== -1) {
        startIdx = firstBracket;
        endChar = ']';
      }

      if (startIdx === -1) {
        throw new Error("AI tidak memberikan format data JSON yang bisa dikenali.");
      }

      const lastOccurrence = collapsed.lastIndexOf(endChar);
      let candidate = "";
      
      if (lastOccurrence > startIdx) {
        candidate = collapsed.substring(startIdx, lastOccurrence + 1);
      } else {
        // Truncated case
        candidate = collapsed.substring(startIdx);
      }

      // 5. Advanced Repair for Truncated JSON
      try {
        // Try cleaning trailing commas first
        const fixedCommas = candidate.replace(/,\s*([\}\]])/g, "$1");
        return JSON.parse(fixedCommas);
      } catch (e3) {
        // Try auto-closing braces/brackets
        let openBraces = 0;
        let openBrackets = 0;
        let inString = false;
        let escaped = false;

        for (let i = 0; i < candidate.length; i++) {
          const char = candidate[i];
          if (escaped) {
            escaped = false;
            continue;
          }
          if (char === '\\') {
            escaped = true;
            continue;
          }
          if (char === '"') {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (char === '{') openBraces++;
            else if (char === '}') openBraces--;
            else if (char === '[') openBrackets++;
            else if (char === ']') openBrackets--;
          }
        }

        let reconstructed = candidate;
        if (inString) reconstructed += '"';
        if (openBrackets > 0) reconstructed += ']'.repeat(openBrackets);
        if (openBraces > 0) reconstructed += '}'.repeat(openBraces);

        try {
          return JSON.parse(reconstructed.replace(/,\s*([\}\]])/g, "$1"));
        } catch (e4) {
          console.error("Critical JSON Parse Failure. Raw:", text);
          throw new Error("Hasil dari AI terpotong atau terlalu panjang. Coba perkecil teks input atau kurangi pilihan kelas.");
        }
      }
    }
  }
}

async function parseResponseJson(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    if (text.includes("<!doctype html") || text.includes("<html") || text.includes("<!DOCTYPE html")) {
      throw new Error("Layanan server sedang memuat ulang (server restart) atau tidak dapat dijangkau. Silakan tunggu beberapa saat lalu coba lagi.");
    }
    throw new Error(`Format balasan server tidak valid (bukan JSON): ${text.substring(0, 100)}`);
  }
  return response.json();
}

function extractKeysFromInvalidJson(text: string) {
  const result: Record<string, string> = {};
  const keys = ['lampiran', 'soal', 'materi', 'lkpd'];
  
  for (const key of keys) {
    const keyRef = `"${key}"`;
    const keyIdx = text.indexOf(keyRef);
    if (keyIdx === -1) continue;
    
    const colonIdx = text.indexOf(':', keyIdx + keyRef.length);
    if (colonIdx === -1) continue;
    
    const startQuoteIdx = text.indexOf('"', colonIdx + 1);
    if (startQuoteIdx === -1) continue;
    
    let content = "";
    let escaped = false;
    for (let i = startQuoteIdx + 1; i < text.length; i++) {
      const char = text[i];
      if (escaped) {
        content += char;
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
        content += char;
      } else if (char === '"') {
        break;
      } else {
        content += char;
      }
    }
    
    if (content) {
      if (content.endsWith('\\')) {
        content = content.slice(0, -1);
      }
      try {
        result[key] = JSON.parse(`"${content}"`);
      } catch (e) {
        result[key] = content
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r')
          .replace(/\\\\/g, '\\');
      }
    }
  }
  return result;
}

async function robustFetch(url: string, options: RequestInit, retries = 4, delay = 2000): Promise<Response> {
  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get("content-type") || "";
    const isHtml = contentType.toLowerCase().includes("text/html");
    const isErrorOrHtml = [502, 503, 504].includes(response.status) || isHtml;

    if (isErrorOrHtml && retries > 0) {
      console.warn(`[Client] Received status ${response.status} or HTML response (${contentType}). Server might be restarting. Retrying in ${delay}ms... (Remaining retries: ${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return robustFetch(url, options, retries - 1, delay * 2);
    }
    return response;
  } catch (err: any) {
    if (retries > 0) {
      console.warn(`[Client] Network error: ${err.message || 'Failed to fetch'}. Retrying in ${delay}ms... (Remaining retries: ${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return robustFetch(url, options, retries - 1, delay * 2);
    }
    throw err;
  }
}

const TP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cpPerClass: {
      type: Type.ARRAY,
      description: "Pemetaan potongan CP yang relevan untuk SETIAP kelas",
      items: {
        type: Type.OBJECT,
        properties: {
          classId: { type: Type.STRING, description: "ID Kelas (harus salah satu dari list yang dipilih)" },
          cpSummary: { type: Type.STRING, description: "Ringkasan kompetensi spesifik untuk kelas tersebut" }
        },
        required: ["classId", "cpSummary"]
      }
    },
    tujuanPembelajaran: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          element: { type: Type.STRING, description: "Elemen/Domain CP (misal: Aljabar, Menyimak, dsb)" },
          statement: { type: Type.STRING, description: "Kalimat lengkap Tujuan Pembelajaran (TP)" },
          competency: { type: Type.STRING, description: "Kompetensi" },
          content: { type: Type.STRING, description: "Lingkup Materi" },
          classLevel: { type: Type.STRING, description: "Kelas (ID)" },
          indikatorTp: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                indikator: { type: Type.STRING, description: "Kalimat Indikator Tujuan Pembelajaran yang konkret dan terukur (misal: 'Peserta didik mampu menyebutkan...')" },
                kktp: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Daftar 3-4 Kriteria Ketercapaian (KKTP) menggunakan taksonomi Bloom (C1-C6) khusus untuk indikator ini. Format wajib: '[C1 - Mengingat] Siswa mampu...'"
                }
              },
              required: ["indikator", "kktp"]
            },
            description: "Daftar Indikator Tujuan Pembelajaran, masing-masing dengan KKTP tersendiri"
          }
        },
        required: ["id", "element", "statement", "competency", "content", "classLevel", "indikatorTp"]
      }
    }
  },
  required: ["cpPerClass", "tujuanPembelajaran"]
};

export async function generateTP(cpContent: string, phase: Phase, selectedClasses: string[], subject?: string): Promise<MappingResult> {
  const prompt = `
    Anda adalah pakar kurikulum Kurikulum Merdeka di Indonesia.
    Tugas: Analisis Capaian Pembelajaran (CP) Fase ${phase} secara MENDALAM dan KOMPREHENSIF. Petakan ke kelas: ${selectedClasses.join(', ')}.
    ${subject ? `\nMata Pelajaran Utama: ${subject}\nATURAN MUTLAK: Tujuan Pembelajaran (TP) dan lingkup materi yang dihasilkan HANYA BOLEH mengandung materi yang sesuai dengan mata pelajaran ${subject}. JANGAN memasukkan TP, materi, kompetensi, atau istilah dari mata pelajaran lain. JIKA CP TERLIHAT UMUM, ANDA WAJIB MENGKHUSUSKAN/MENAFSIRKANNYA KE DALAM KONTEKS MATA PELAJARAN ${subject} SAJA.` : ''}
    
    TEKS CP ASLI:
    "${cpContent.substring(0, 4000)}"
    
    INSTRUKSI OUTPUT (WAJIB DIPATUHI):
    1. ANALISIS KONTEN & MATERI (Langkah Pertama):
       - Baca Capaian Pembelajaran secara utuh.
       - Identifikasi "Kompetensi" (skill/kemampuan yang diukur) dan "Lingkup Materi" (topik/konsep esensial yang diajarkan).
       - Pemetaan kelas & Distribusi yang Merata (SANGAT PENTING): Pastikan materi-materi tersebut dibagikan/didistribusikan ke kelas yang diminta (${selectedClasses.join(', ')}) secara BERIMBANG, PROPORSIONAL, DAN MERATA berdasarkan tingkat kemudahannya (prasyarat diajarkan di kelas lebih rendah). Hindari ketimpangan ekstrem di mana salah satu kelas memiliki terlalu banyak TP sedangkan kelas lainnya terlalu sedikit TP.
       - SANGAT PENTING (Kesesuaian Materi): PASTIKAN semua TP yang dipetakan dari CP HANYA MENGANDUNG MATERI YANG SESUAI dengan substansi pada mata pelajaran ${subject || 'terkait'}. ELIMINASI materi yang bukan dari mata pelajaran tersebut.
    2. cpPerClass: Tulis ulang (breakdown) teks CP asli menjadi ringkasan kompetensi dan lingkup materi yang DETAIL, SPESIFIK, dan KOMPREHENSIF untuk SETIAP kelas. 
       PASTIKAN TIDAK ADA MATERI ATAU KOMPETENSI DARI CP ASLI YANG HILANG.
       Gunakan ID kelas ini secara eksak dalam output: [${selectedClasses.join(', ')}].
    3. tujuanPembelajaran: Turunkan TP yang spesifik dan operasional berdasarkan lingkup materi yang telah di analisis di setiap kelas tersebut.
       - **ATURAN MUTLAK CAKUPAN CP (100% CAKUPAN CP WAJIB MASUK KE TP)**: Seluruh kalimat, setiap kompetensi, setiap materi, dan setiap domain yang tertulis di dalam Teks CP Asli WAJIB terwakili dan tercover sepenuhnya di dalam daftar Tujuan Pembelajaran (TP) yang dihasilkan. Dilarang keras melakukan pemotongan, penyederhanaan berlebihan, atau membiarkan ada bagian CP asli yang terlewat atau tidak memiliki TP pendampingnya. Semua bagian CP harus tuntas terpetakan menjadi TP!
       - ATURAN MUTLAK KESESUAIAN MATERI: Tujuan Pembelajaran (dan field "statement", "content") HANYA BOLEH mendeskripsikan materi / topik yang 100% merupakan murni kurikulum dari mata pelajaran ${subject || 'terkait'}. 
       - Sertakan kolom "content" pada hasil JSON TP berisi inti materi yang relevan.
       - JUMLAH TP & KESETARAAN: Pastikan jumlah TP mencakup SELURUH cakupan materi dalam CP (jangan terlalu sedikit). Susunlah TP secara berkualitas tinggi, runtut, logis, dan terdistribusi merata di setiap kelas yang terpilih.
       - WAJIB: Field "classLevel" HARUS diisi dengan salah satu ID dari: [${selectedClasses.join(', ')}]. 
       - Jangan pernah menggunakan kata "Kelas" di dalam field "classLevel", cukup ID-nya saja.
    4. IDENTIFIKASI ELEMEN: Teks CP yang diberikan dipisahkan berdasarkan baris baru (newline).
       - SANGAT PENTING: Setiap baris baru dalam teks CP asli MEREPRESENTASIKAN SATU ELEMEN/DOMAIN YANG BERBEDA.
       - Anda WAJIB membaca setiap baris sebagai Elemen yang terpisah dan mengidentifikasinya dengan tepat.
       - Setiap TP HARUS dikategorikan ke dalam Elemen yang sesuai berdasarkan baris aslinya di teks CP.
       - JANGAN membuat nama elemen baru, gunakan struktur baris yang ada.
    5. PROPORSI TP PER ELEMEN: Setiap Elemen (setiap baris dari teks CP) WAJIB memiliki TP yang memadai untuk mencakup seluruh isi kompetensinya di SETIAP kelas secara proporsional. Hindari kesenjangan jumlah TP yang mencolok antarelemen; usahakan agar cakupan dan distribusinya berimbang dan berurutan secara logis.
    6. indikatorTp & kktp: **SANGAT PENTING & WAJIB**: Setiap Tujuan Pembelajaran (TP) harus dipecah menjadi beberapa **Indikator Tujuan Pembelajaran (indikatorTp)** yang konkret dan terukur.
       - Di dalam field "indikatorTp" (yang berupa array of object), tentukan minimal 2-3 Indikator TP.
       - Untuk **SETIAP** Indikator TP tersebut, susunlah Kriteria Ketercapaian Tujuan Pembelajaran (KKTP) secara mendalam menggunakan Taksonomi Bloom (tingkat kognitif C1 hingga C6) yang relevan dan diturunkan langsung dari indikator tersebut secara kritis.
       - Masukkan KKTP ini ke dalam field "kktp" di dalam objek Indikator TP masing-masing (berupa array of string). Berikan 3-4 kriteria KKTP yang konkret, terukur, dan detail untuk masing-masing indikator.
       - Di setiap butir KKTP, Anda **WAJIB** mencantumkan level/tingkat kognitif Bloom di dalam tanda kurung siku di awal kalimat secara eksplisit, misalnya:
         - "[C1 - Mengingat] Peserta didik mampu menyebutkan..."
         - "[C2 - Memahami] Peserta didik mampu menjelaskan..."
         - "[C3 - Menerapkan] Peserta didik mampu menggunakan..."
         - "[C4 - Menganalisis] Peserta didik mampu menganalisis..."
         - "[C5 - Mengevaluasi] Peserta didik mampu mengevaluasi..."
         - "[C6 - Menciptakan] Peserta didik mampu merancang..."
       
       **ATURAN MUTLAK INDIKATOR & KKTP**: Keduanya harus berupa pernyataan operasional yang terukur (pernyataan deklaratif, diawali dengan 'Peserta didik mampu...' atau 'Siswa dapat...'). **DILARANG KERAS MENGGUNAKAN KALIMAT TANYA ATAU INSTRUMEN PERTANYAAN/SOAL**. KKTP adalah kriteria ketercapaian, bukan latihan soal atau evaluasi tertulis.
       Pastikan setiap butir ditulis dengan sangat detail, bervariasi tingkat kognitifnya, dan menggunakan Kata Kerja Operasional (KKO) yang tepat. JANGAN disingkat.
    7. Elemen Field: Isi field "element" dengan nama Elemen yang tepat dari teks CP.
    
    PENTING: Pastikan ID kelas dalam output sinkron dengan: [${selectedClasses.join(', ')}].
    OPTIMASI: Jangan melakukan simplifikasi berlebihan. Jika materi dalam CP luas, maka jumlah TP harus menyesuaikan luasnya materi tersebut agar tidak ada materi yang terlewat.
    USER NOTE: Elemen sudah dimasukkan dalam teks CP, pastikan Anda mengekstraknya dengan benar.
    
    ATURAN TEKNIS (CRITICAL): 
    - Output HARUS JSON murni tanpa ada teks tambahan sebelum/sesudah.
    - DILARANG KERAS menyertakan spasi baris baru (newline) atau tab berlebih di dalam nilai string. 
    - Pastikan JSON sepadat mungkin agar tidak menyentuh limit token atau menyebabkan error parsing.
  `;

  try {
    const requestBody = JSON.stringify({ prompt, schema: TP_SCHEMA });
    console.log(`[OpenAIService] Request size (TP): ${(requestBody.length / 1024).toFixed(2)} KB`);
    
    const response = await robustFetch("/api/openai/generate-tp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }).catch(err => {
      console.error("Fetch implementation error details:", err);
      throw new Error(`Koneksi terputus: ${err.message || "Gagal menghubungkan ke server."}`);
    });

    if (!response.ok) {
      let errorMsg = `Layanan AI tidak merespon (Status ${response.status}).`;
      try {
        const errorData = await parseResponseJson(response);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        // Fallback if not JSON
        const rawText = await response.text().catch(() => "");
        if (rawText.length > 0) {
          console.warn("Raw error response:", rawText);
          if (rawText.includes("<html>")) errorMsg = "Server mengalami gangguan teknis (HTML error).";
        }
      }
      throw new Error(errorMsg);
    }

    const { text } = await parseResponseJson(response);
    
    if (!text) throw new Error("AI tidak memberikan respon (kosong).");
    
    try {
      const parsed = safeParseJson(text);
      
      // Convert cpPerClass array back to map to maintain compatibility with App.tsx
      const cpMap: Record<string, string> = {};
      if (Array.isArray(parsed.cpPerClass)) {
        parsed.cpPerClass.forEach((item: any) => {
          if (item.classId && item.cpSummary) {
            const cleanKey = normalizeClassLevel(item.classId, selectedClasses);
            cpMap[cleanKey] = item.cpSummary;
          }
        });
      } else if (typeof parsed.cpPerClass === 'object' && parsed.cpPerClass !== null) {
        // Fallback in case AI ignored array schema and outputted object
        Object.entries(parsed.cpPerClass).forEach(([key, val]) => {
          const cleanKey = normalizeClassLevel(key, selectedClasses);
          cpMap[cleanKey] = String(val);
        });
      }

      const rawTps = Array.isArray(parsed.tujuanPembelajaran) ? parsed.tujuanPembelajaran : [];
      const cleanTps = rawTps
        .filter((tp: any) => tp && typeof tp === 'object')
        .map((tp: any, index: number) => {
          const cleanClassLevel = normalizeClassLevel(tp.classLevel, selectedClasses);
          const rawId = tp.id || `TP${index + 1}`;
          const uniqueId = rawId.includes(cleanClassLevel) ? rawId : `${cleanClassLevel}_${rawId}`;
          
          const rawIndikators = Array.isArray(tp.indikatorTp) ? tp.indikatorTp : [];
          const cleanIndikators = rawIndikators
            .filter((ind: any) => ind && typeof ind === 'object')
            .map((ind: any) => {
              const rawKktp = Array.isArray(ind.kktp) ? ind.kktp : [];
              const cleanKktp = rawKktp.map((k: any) => String(k || '')).filter(Boolean);
              return {
                indikator: String(ind.indikator || ''),
                kktp: cleanKktp
              };
            });

          return {
            id: uniqueId,
            element: String(tp.element || ''),
            statement: String(tp.statement || ''),
            competency: String(tp.competency || ''),
            content: String(tp.content || ''),
            classLevel: cleanClassLevel,
            indikatorTp: cleanIndikators,
            materials: Array.isArray(tp.materials) ? tp.materials.map((m: any) => String(m || '')) : [],
            meetings: Array.isArray(tp.meetings) ? tp.meetings.filter((m: any) => m && typeof m === 'object').map((m: any) => ({
              session: Number(m.session) || 1,
              activity: String(m.activity || '')
            })) : []
          };
        });

      return {
        cpOriginal: cpContent,
        phase,
        classes: selectedClasses,
        cpPerClass: cpMap,
        tujuanPembelajaran: cleanTps
      };
    } catch (parseError: any) {
      console.error("Parse Error Raw Text:", text);
      throw new Error(`Gagal membaca hasil dari AI: ${parseError.message}`);
    }
  } catch (error: any) {
    console.error("OpenAI Service Error:", error);
    if (error.message?.includes('403') || error.message?.includes('400')) {
      throw new Error("Gagal menghubungkan ke AI. Ada masalah dengan format data atau kunci API.");
    }
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('limit')) {
      throw new Error(error.message);
    }
    throw new Error(error.message || "Gagal menghubungkan ke layanan AI.");
  }
}

const CLARIFY_TP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    statement: { type: Type.STRING, description: "Kalimat lengkap Tujuan Pembelajaran (TP) yang telah diperjelas secara rinci, konkret, dan operasional." },
    competency: { type: Type.STRING, description: "Kompetensi utama yang diukur." },
    content: { type: Type.STRING, description: "Lingkup Materi pembelajaran esensial." },
    indikatorTp: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          indikator: { type: Type.STRING, description: "Kalimat Indikator Tujuan Pembelajaran yang konkret dan terukur (misal: 'Peserta didik mampu menyebutkan...')" },
          kktp: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Daftar 3-4 Kriteria Ketercapaian (KKTP) menggunakan taksonomi Bloom (C1-C6) khusus untuk indikator ini. Format wajib: '[C1 - Mengingat] Siswa mampu...'"
          }
        },
        required: ["indikator", "kktp"]
      },
      description: "Daftar Indikator Tujuan Pembelajaran yang lebih jelas dan mendalam"
    }
  },
  required: ["statement", "competency", "content", "indikatorTp"]
};

export async function clarifySingleTP(tp: TujuanPembelajaran, subject?: string): Promise<Partial<TujuanPembelajaran>> {
  const prompt = `
    Anda adalah pakar kurikulum Kurikulum Merdeka di Indonesia.
    Tugas Anda adalah memperjelas ("clarify"), merinci, dan mendalami Tujuan Pembelajaran (TP) berikut agar menjadi lebih konkret, terukur, dan operasional:
    
    TP Asli: "${tp.statement}"
    Elemen: "${tp.element}"
    Mata Pelajaran: "${subject || 'Umum'}"
    
    INSTRUKSI:
    1. Perjelas kalimat TP ("statement") agar menggambarkan secara eksak kompetensi dan materi secara jelas dan bermakna. JANGAN menyingkatnya.
    2. Identifikasi "competency" (kata kerja kompetensi) dan "content" (lingkup materi esensial) yang terkandung di dalamnya dengan presisi.
    3. Buatlah minimal 3 Indikator Tujuan Pembelajaran ("indikatorTp") yang konkret dan terukur (diawali kalimat deklaratif "Peserta didik mampu...").
    4. Untuk SETIAP Indikator TP tersebut, susunlah 3-4 Kriteria Ketercapaian (KKTP) yang mendalam menggunakan tingkatan Taksonomi Bloom (C1-C6) secara eksplisit.
       Format KKTP wajib diawali level kognitif, contoh: '[C2 - Memahami] Peserta didik mampu...' atau '[C4 - Menganalisis] Peserta didik mampu...'.
    
    ATURAN MUTLAK:
    - JANGAN menggunakan kalimat tanya dalam indikator maupun KKTP.
    - Output harus berupa JSON murni yang sesuai dengan schema yang diminta.
  `;

  try {
    const requestBody = JSON.stringify({ prompt, schema: CLARIFY_TP_SCHEMA });
    const response = await robustFetch("/api/openai/generate-tp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    if (!response.ok) {
      throw new Error(`Server API returned status ${response.status}`);
    }

    const { text } = await parseResponseJson(response);
    if (!text) throw new Error("Respon AI kosong.");

    const parsed = safeParseJson(text);
    return {
      statement: parsed.statement || tp.statement,
      competency: parsed.competency || tp.competency,
      content: parsed.content || tp.content,
      indikatorTp: parsed.indikatorTp || tp.indikatorTp,
    };
  } catch (err: any) {
    console.error("clarifySingleTP error:", err);
    throw err;
  }
}

const MATERIAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    materials: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Daftar cakupan materi atau lingkup materi yang mendalam berdasarkan TP"
    },
    meetings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          session: { type: Type.NUMBER },
          activity: { type: Type.STRING, description: "Ringkasan aktivitas pembelajaran untuk pertemuan tersebut" }
        },
        required: ["session", "activity"]
      }
    }
  },
  required: ["materials", "meetings"]
};

export async function generateMaterials(tp: TujuanPembelajaran, jpPerWeek?: number, numberOfMeetings?: number, subject?: string): Promise<{ materials: string[], meetings: { session: number, activity: string }[] }> {
  const prompt = `
    Berdasarkan Tujuan Pembelajaran (TP) berikut:
    TP: ${tp.statement}
    Kriteria (KKTP): ${tp.indikatorTp.map(ind => `${ind.indikator}: ${ind.kktp.join(', ')}`).join('; ')}
    ${subject ? `Mata Pelajaran: ${subject}` : ''}
    ${jpPerWeek ? `Alokasi Waktu Mata Pelajaran: ${jpPerWeek} JP per minggu.` : ''}
    ${numberOfMeetings ? `ATURAN WAJIB: Anda HARUS menjabarkan materi ini menjadi TEPAT ${numberOfMeetings} pertemuan (sesuai ATP).` : ''}
    
    Tugas:
    1. Tentukan Lingkup Materi (Scope) yang harus dipelajari agar TP ini tercapai secara mendalam. Jangan melewatkan detail penting.
    2. Berikan Rekomendasi Pertemuan beserta ringkasan aktivitas pembelajarannya.
       PENTING: Anda WAJIB memberikan jumlah pertemuan yang CUKUP dan LOGIS untuk menuntaskan materi secara mendalam. 
       Jangan membuat jumlah pertemuan menjadi terlalu sedikit jika materinya padat.
       ${numberOfMeetings ? `ATURAN WAJIB: Anda HARUS menjabarkan materi ini menjadi TEPAT ${numberOfMeetings} pertemuan.` : 'Tentukan jumlah pertemuan (misal 2-4 pertemuan) yang ideal untuk TP ini.'}
       Pastikan setiap pertemuan berurutan dan logis.
    
    Pastikan output adalah JSON murni yang padat tanpa spasi atau baris baru berlebih di dalam nilai string.
  `;

  try {
    const requestBody = JSON.stringify({ prompt, schema: MATERIAL_SCHEMA });
    console.log(`[OpenAIService] Request size (Materials): ${(requestBody.length / 1024).toFixed(2)} KB`);

    const response = await robustFetch("/api/openai/generate-materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }).catch(err => {
      console.error("Fetch materials error details:", err);
      throw new Error(`Koneksi terputus: ${err.message || "Gagal menghubungkan ke server."}`);
    });

    if (!response.ok) {
      let errorMsg = "Gagal merekomendasikan materi.";
      try {
        const errorData = await parseResponseJson(response);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        errorMsg = `Server error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMsg);
    }

    const { text } = await parseResponseJson(response);
    if (!text) throw new Error("AI tidak memberikan respon (kosong).");
    
    const parsed = safeParseJson(text);
    if (parsed && Array.isArray(parsed.meetings)) {
      parsed.meetings.sort((a: any, b: any) => (parseInt(a.session) || 0) - (parseInt(b.session) || 0));
    }
    return parsed;
  } catch (error: any) {
    console.error("OpenAI Material Error:", error);
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('limit')) {
      throw new Error(error.message);
    }
    throw new Error(error.message || "Gagal merekomendasikan materi. Silakan coba lagi.");
  }
}

const MODUL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    cp: { type: Type.STRING, description: "Capaian Pembelajaran (CP) asal/sumber untuk Tujuan Pembelajaran ini (bisa dikosongkan jika tidak ada)" },
    tpStatement: { type: Type.STRING, description: "Kalimat Tujuan Pembelajaran (TP)" },
    targetStudents: { type: Type.STRING, description: "Jenjang dan kelas target (WAJIB SESUAI DENGAN KELAS INPUT, JANGAN MENGARANG)" },
    duration: { type: Type.STRING, description: "Alokasi waktu (WAJIB SESUAI JP YANG DIBERIKAN. misal jika 3 JP: '3 JP' atau '3 x 45 menit')" },
    ppp: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Dimensi Profil Lulusan yang paling relevan (pilih 2-3 dari: 'Keimanan & Ketakwaan', 'Kewargaan', 'Penalaran Kritis', 'Kreativitas', 'Kolaborasi', 'Kemandirian', 'Kesehatan', 'Komunikasi'). JANGAN sertakan awalan 'Profil Lulusan:' atau 'Profil Lulusan ', tuliskan nama dimensinya langsung saja."
    },
    media: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Media, alat, dan bahan pembelajaran"
    },
    meaningfulUnderstanding: { type: Type.STRING, description: "Pemahaman Bermakna" },
    triggerQuestions: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Pertanyaan Pemantik"
    },
    model: { type: Type.STRING },
    meetingActivities: {
      type: Type.ARRAY,
      description: "Rincian kegiatan pembelajaran yang dipisah per pertemuan (sesi)",
      items: {
        type: Type.OBJECT,
        properties: {
          session: { type: Type.INTEGER, description: "Nomor pertemuan (misal: 1, 2, dst)" },
          activityTitle: { type: Type.STRING, description: "Fokus atau Topik Kegatan pada pertemuan tersebut" },
          steps: {
            type: Type.ARRAY,
            description: "Daftar fase kegiatan pembelajaran. WAJIB berisi TEPAT 3 elemen/item secara berurutan: Pendahuluan, Kegiatan Inti, dan Penutup. JANGAN memecah Kegiatan Inti menjadi beberapa fase/sintaks terpisah di dalam array ini.",
            items: {
              type: Type.OBJECT,
              properties: {
                phase: { type: Type.STRING, description: "Nama tahapan/fase kegiatan. WAJIB diisi salah satu dari: 'Pendahuluan', 'Kegiatan Inti', atau 'Penutup' secara berurutan." },
                activity: { type: Type.STRING, description: "Penjelasan SANGAT RINCI tentang aktivitas apa yang dilakukan guru dan apa yang dilakukan siswa beserta dengan rentang waktu." }
              },
              required: ["phase", "activity"]
            }
          }
        },
        required: ["session", "activityTitle", "steps"]
      }
    },
    assessment: { type: Type.STRING, description: "Metode penilaian yang digunakan" },
    differentiation: { type: Type.STRING, description: "Strategi diferensiasi (konten/proses/produk)" },
    rubrics: { type: Type.STRING, description: "Rubrik penilaian dalam format HTML (tabel)" }
  },
  required: [
    "title", "tpStatement", "targetStudents", "duration", "ppp", "media", 
    "meaningfulUnderstanding", "triggerQuestions", "model", 
    "meetingActivities", "assessment", "differentiation", "rubrics"
  ]
};

export async function generateKelengkapanModulOtomatis(modul: ModulAjar): Promise<{lampiran?: string, soal?: string, materi?: string, lkpd?: string}> {
  console.log(`[Client] Memulai generasi kelengkapan secara sekuensial untuk Modul Ajar: ${modul.title}`);
  
  const materi = await generateMateri(modul).catch(err => {
    console.error("Gagal membuat materi ajar otomatis:", err);
    return "";
  });
  
  // Berikan sedikit jeda (pacing) untuk kestabilan server & menghindari rate limits/timeouts
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const lkpd = await generateLKPD(modul).catch(err => {
    console.error("Gagal membuat LKPD otomatis:", err);
    return "";
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const soal = await generateSoal(modul).catch(err => {
    console.error("Gagal membuat Soal otomatis:", err);
    return "";
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const lampiran = await generateLampiran(modul).catch(err => {
    console.error("Gagal membuat Lampiran otomatis:", err);
    return "";
  });

  return {
    materi: materi || undefined,
    lkpd: lkpd || undefined,
    soal: soal || undefined,
    lampiran: lampiran || undefined
  };
}

export async function generateLampiran(modul: ModulAjar): Promise<string> {
  const meetingDetails = modul.meetingActivities?.map(ma => {
    const stepsStr = ma.steps?.map(s => `- [${s.phase}] ${s.activity}`).join('\n') || '';
    return `Pertemuan Ke-${ma.session}: ${ma.activityTitle}\nLangkah Kegiatan:\n${stepsStr}`;
  }).join('\n\n') || '';

  const prompt = `Anda adalah ahli kurikulum ahli Kemdikbudristek. Buat lampiran luar biasa lengkap, detail, dan profesional untuk Modul Ajar berjudul "${modul.title}".

Tujuan Pembelajaran: ${modul.tpStatement}
Asesmen yang direncanakan: ${modul.assessment}
Rencana Kegiatan Pembelajaran per Pertemuan (SEBAGAI ACUAN SINKRONISASI SAJA):
${meetingDetails}

PENTING & WAJIB (HILANGKAN BAGIAN KEGIATAN PEMBELAJARAN DARI OUTPUT):
1. Anda DILARANG KERAS menyertakan kembali daftar Rencana Kegiatan Pembelajaran per Pertemuan atau langkah-langkah pembelajaran di dalam isi dokumen Lampiran ini. Bagian langkah kegiatan tersebut sepenuhnya DIHILANGKAN dari teks Lampiran karena sudah tertulis lengkap di Modul Ajar utama.
2. Dokumen Lampiran harus murni berisi instrumen penunjang, yaitu: Materi Ajar, LKPD, Rubrik Penilaian, Alat Asesmen, dan Refleksi.
3. Anda WAJIB menyesuaikan seluruh Materi Ajar, LKPD, Asesmen (Formatif & Sumatif), alat penilaian, lembar instrumen, dan rubrik secara spesifik agar sinkron secara presisi dengan langkah kegiatan pembelajaran yang telah dirancang untuk setiap pertemuan di atas.
4. **SINKRONISASI SOAL EVALUASI & JUMLAH SOAL (WAJIB SAMA PERSIS DENGAN DI MODUL)**: Jika di dalam Modul Ajar atau langkah pembelajarannya dirancang adanya kuis, tes formatif, tes sumatif, atau soal latihan evaluasi, Anda WAJIB menyajikan naskah rincian butir-butir soal tertulis tersebut secara riil, utuh, dan lengkap langsung di dalam Lampiran ini beserta kunci jawaban dan panduan penskorannya.
5. **JUMLAH SOAL HARUS SAMA PERSIS**: Jumlah butir soal pilihan ganda (PG) dan soal esai/uraian yang ditampilkan di dalam naskah soal Lampiran ini WAJIB SAMA PERSIS dengan jumlah soal yang disebutkan/diterapkan di dalam Modul Ajar utama (misalnya pada bagian Asesmen atau langkah pembelajaran). 
   - Contoh: Jika di dalam Modul Ajar tertulis "5 soal pilihan ganda dan 2 soal uraian/esai", maka naskah soal di Lampiran ini harus memuat tepat 5 soal PG (lengkap opsi A, B, C, D, E) dan tepat 2 soal uraian/esai. DILARANG KERAS memuat jumlah soal yang berbeda dengan yang tertulis di dalam Modul Ajar utama.
   - JIKA TIDAK DISEBUTKAN SECARA SPESIFIK: Jika jumlah soal tidak ditulis secara eksplisit di dalam modul, maka Anda wajib menyajikan tepat 5 soal pilihan ganda (PG) dan tepat 3 soal esai/uraian di Lampiran ini.
   - **PENTING: SEMUA SOAL HARUS LENGKAP & TERTULIS SEMUANYA**: Anda WAJIB memastikan semua soal ditulis secara utuh satu per satu tanpa ada yang terpotong atau disingkat. JANGAN hanya menuliskan sebagian soal (misalnya hanya menulis 2 dari 5 soal lalu menulis "dan seterusnya" atau "dst."). Jika di Modul tertulis 5 soal pilihan ganda, maka kelima soal tersebut harus ditulis secara lengkap masing-masing dengan pilihan jawaban A, B, C, D, E, kunci jawaban, dan pembahasannya. JANGAN menggunakan placeholder atau memotong naskah soal. Pastikan kelengkapan naskah soal 100% sempurna!
JANGAN menggunakan template umum atau kosong! Tulis instrumen evaluasi riil yang sinkron dengan alur kegiatan.

Instruksi Pembuatan Mandat Spesifik:
1. **Rubrik Penilaian Unjuk Kerja / Proyek Lengkap & Kriteria Ketuntasan**: Buatlah tabel rubrik dengan kriteria penilaian yang jelas untuk setiap asesmen formatif/sumatif yang direncanakan di setiap pertemuan, skala nilai (Sangat Baik [4], Baik [3], Cukup [2], Perlu Bimbingan [1]), beserta deskripsi capaian di setiap sel tabel secara konkret dan aplikatif. JANGAN mengosongkan sel atau menggunakan "dst.".
2. **Lembar & Alat Observasi Asesmen**: Sediakan instrumen penilaian praktis (checklist observasi guru, lembar penilaian diri, atau lembar penilaian antar-teman) beserta rubrik penskorannya yang sesuai dengan target kompetensi dalam kegiatan pembelajaran.
3. **Penilaian Dimensi Profil Lulusan**: Sediakan instrumen checklist/rubrik rinci untuk menilai dimensi profil lulusan yang dikembangkan di sepanjang pembelajaran (misal: bernalar kritis, gotong royong, kreatif, atau kemandirian).
4. **Naskah & Butir Soal Evaluasi / Asesmen Sumatif (WAJIB ADA SOAL RIIL - KONSISTEN DENGAN JUMLAH SOAL MODUL)**: Anda WAJIB menyajikan naskah soal tes tertulis secara utuh dan lengkap (jumlah soal harus mengikuti aturan SINKRONISASI SOAL EVALUASI & JUMLAH SOAL di atas) beserta opsi jawaban A, B, C, D, E, kunci jawaban, dan kriteria skor penilainnya. Hal ini agar Lampiran dapat langsung dicetak oleh guru untuk diujikan kepada siswa.
5. **Instrumen Refleksi Guru & Siswa**: Tuliskan minimal 5 pertanyaan refleksi yang mendalam bagi siswa, serta 5 aspek refleksi diagnostik bagi guru.
6. **Glosarium Istilah & Daftar Pustaka**: Tuliskan glosarium istilah-istilah sulit yang dipelajari beserta definisinya, dan daftar pustaka akademis formal sesuai jenjang.

WAJIB - DIAGRAM & GRAFIS VISUAL:
Jika relevan, Anda harus menyertakan diagram/visualisasi proses penilaian, siklus refleksi, atau bagan rubrik menggunakan tag <svg> (diagram vektor warna pastel yang menarik) ATAU menggunakan tag <img> dengan foto pendidikan Unsplash berkualitas tinggi (sertakan referrerpolicy="no-referrer" dan class penunjang seperti rounded-xl).

Sajikan dalam format HTML murni (gunakan tag seperti <h3>, <h4>, <p>, <ul>, <ol>, <li>, <table>, <tr>, <th>, <td>, <b> tanpa membungkus dengan melilit markup markdown). `;
  return await generateSimpleText(prompt);
}

export async function generateSoal(modul: ModulAjar): Promise<string> {
  const meetingDetails = modul.meetingActivities?.map(ma => {
    const stepsStr = ma.steps?.map(s => `- [${s.phase}] ${s.activity}`).join('\n') || '';
    return `Pertemuan Ke-${ma.session}: ${ma.activityTitle}\nLangkah Kegiatan:\n${stepsStr}`;
  }).join('\n\n') || '';

  const prompt = `Anda adalah ahli pengembang instrumen evaluasi pendidikan Kemdikbudristek. Buat soal evaluasi (Formatif & Sumatif) kelas secara lengkap, detail, dan profesional untuk Modul Ajar berjudul "${modul.title}".

Tujuan Pembelajaran: ${modul.tpStatement}
Asesmen yang direncanakan: ${modul.assessment}
Rencana Kegiatan Pembelajaran per Pertemuan:
${meetingDetails}

PENTING & WAJIB (SINKRONISASI JUMLAH SOAL):
1. Periksa dengan teliti bagian Asesmen ("assessment" di atas) and langkah-langkah kegiatan di dalam Modul Ajar untuk melihat apakah ada jumlah butir soal pilihan ganda (PG) and esai/uraian yang direncanakan secara spesifik.
2. JUMLAH SOAL HARUS SAMA PERSIS dengan jumlah soal yang disebutkan/diterapkan di dalam Modul Ajar tersebut. 
   - Contoh: Jika di dalam Modul Ajar (assessment/langkah) tertulis "5 soal pilihan ganda dan 2 soal esai/uraian", maka Anda WAJIB membuat tepat 5 soal pilihan ganda dan tepat 2 soal esai. DILARANG KERAS membuat jumlah soal yang berbeda dengan yang tertulis di dalam Modul Ajar.
   - JIKA TIDAK DISEBUTKAN SECARA SPESIFIK: Jika jumlah soal tidak ditulis secara eksplisit di dalam modul (misal hanya ditulis "Tes tertulis" saja), maka Anda wajib membuat tepat 5 soal pilihan ganda (PG) dan tepat 3 soal esai/uraian.
   - **PENTING: SEMUA SOAL HARUS LENGKAP & TERTULIS SEMUANYA**: Anda WAJIB memastikan semua soal ditulis secara utuh satu per satu tanpa ada yang terpotong atau disingkat. JANGAN hanya menuliskan sebagian soal (misalnya hanya menulis 2 dari 5 soal lalu menulis "dan seterusnya" atau "dst."). Jika di Modul tertulis 5 soal pilihan ganda, maka kelima soal tersebut harus ditulis secara lengkap masing-masing dengan pilihan jawaban A, B, C, D, E, kunci jawaban, dan pembahasannya. JANGAN menggunakan placeholder atau memotong naskah soal. Pastikan kelengkapan naskah soal 100% sempurna!
3. Pastikan paket soal evaluasi ini benar-benar mencerminkan bentuk asesmen formatif (kuis berkala, pertanyaan pemantik, kuis pemahaman) maupun asesmen sumatif (ujian akhir unit, penugasan esai terstruktur) yang dirancang di dalam kegiatan pembelajaran.
- SESUAIKAN BUTIR SOAL DENGAN MATERI DAN METODE TIAP PERTEMUAN.
- Soal evaluasi harus menguji kompetensi yang relevan dengan aktivitas kelas siswa (contoh: jika di kelas siswa mengamati siklus air, soal harus menguji penalaran dan analisis terkait siklus air, bukan materi luar).
- Sertakan alat asesmen, kunci jawaban, dan rubrik penskoran lengkap untuk semua soal tersebut di sini.

Instruksi Pembuatan Mandat Spesifik:
1. **Soal Pilihan Ganda Bertingkat**: Sediakan butir soal pilihan ganda yang komplit dengan opsi jawaban pilihan A, B, C, D, E. Jumlah soal harus mengikuti aturan SINKRONISASI JUMLAH SOAL di atas. Soal harus berkisar dari soal mudah (LOTS) hingga analisis tinggi (HOTS).
2. **Soal Esai Analitis/Pemecahan Masalah**: Sediakan butir soal esai yang menuntut penalaran kritis, argumentasi ilmiah, dan analisis terapan. Jumlah soal harus mengikuti aturan SINKRONISASI JUMLAH SOAL di atas.
3. **Kunci Jawaban & Rubrik Penilaian Soal**: Berikan kunci jawaban yang pasti untuk pilihan ganda & pedoman penskoran detail bagi soal esai.
4. **Pembahasan Terperinci**: Berikan alasan logis mengapa jawaban tersebut benar untuk mendukung umpan balik diagnostik siswa.

WAJIB - STRUKTUR & FORMATTING KERTAS SOAL HARUS SANGAT RAPI (STANDAR KURIKULUM MERDEKA):
1. **KOP / IDENTITAS SOAL**: Di bagian paling atas, WAJIB menyertakan tabel identitas siswa & mata pelajaran rapi dengan tag <table border="1" cellpadding="6" cellspacing="0" style="width:100%; border-collapse:collapse; margin-bottom:15px; font-size:11pt; font-family:'Times New Roman', serif;"> yang berisi Mata Pelajaran, Kelas/Fase, Materi Utama, Alokasi Waktu, Nama Siswa, dan Hari/Tanggal.
2. **BOX PETUNJUK PENGERJAAN**: Sediakan kotak petunjuk pengerjaan soal yang jelas di bawah Kop Identitas.
3. **PILIHAN GANDA DENGAN FORMAT OPSI SANGAT RAPI**:
   - Setiap butir soal diberi nomor <ol> atau <li> dengan kalimat soal yang jelas.
   - Pilihan jawaban A, B, C, D, E WAJIB diformat dengan tabel tanpa border atau susunan sejajar rapi menggunakan <table border="0" cellpadding="2" cellspacing="0" style="width:100%; border-collapse:collapse; margin-top:4px; margin-left:15px;"> dengan kolom lebar 25px untuk huruf pilihan (<b>A.</b>, <b>B.</b>, dst) dan kolom sisanya untuk teks opsi jawaban. Dilarang keras menumpuk huruf dan teks secara acak!
4. **SOAL URAIAN / ESAI**: Disusun dengan penomoran rapi <ol> dan ruang argumentasi yang jelas.
5. **PEDOMAN PENSKORAN & KUNCI JAWABAN (UNTUK GURU)**:
   - Dibuat di bagian akhir dengan judul yang jelas.
   - Kunci Jawaban Pilihan Ganda & Pembahasan disajikan dalam Tabel HTML berbatas (<table border="1" cellpadding="6" style="width:100%; border-collapse:collapse;">) yang memuat kolom: No, Kunci, Pembahasan Ringkas, dan Skor.
   - Rubrik Penskoran Esai disajikan dalam Tabel HTML berbatas dengan kolom: No, Kriteria Jawaban, dan Skor Maksimal.

WAJIB - GAMBAR & VISUALISASI SOAL:
Jika salah satu soal (misalnya soal geometri, diagram sirkulasi, tabel data, silsilah keluarga, flowchart pilihan) membutuhkan ilustrasi/diagram gambar agar siswa dapat menjawab, Anda WAJIB membuat gambar tersebut menggunakan tag <svg> (vektor inline rapi dengan teks label jelas) atau tag <img> dengan gambar Unsplash yang tepat (sertakan referrerpolicy="no-referrer").

Berikan soal secara interaktif, berjenjang (LOTS hingga HOTS), beserta kunci jawabannya dalam format HTML murni (gunakan tag seperti <h3>, <p>, <table>, <tr>, <td>, <ul>, <ol>, <li>, <b> tanpa melilit dengan markup markdown html).`;
  return await generateSimpleText(prompt);
}

export async function generateMateri(modul: ModulAjar): Promise<string> {
  const meetingDetails = modul.meetingActivities?.map(ma => {
    const stepsStr = ma.steps?.map(s => `- [${s.phase}] ${s.activity}`).join('\n') || '';
    return `Pertemuan Ke-${ma.session}: ${ma.activityTitle}\nLangkah Kegiatan:\n${stepsStr}`;
  }).join('\n\n') || '';

  const prompt = `Posisikan Anda adalah seorang ahli kurikulum, penulis buku sekolah, dosen pendidikan, dan guru profesional yang memahami Kurikulum Merdeka Indonesia secara mendalam.

Tugas Anda adalah menyusun materi pembelajaran yang sangat lengkap berdasarkan Tujuan Pembelajaran (TP) dan Kriteria Ketercapaian Tujuan Pembelajaran (KKTP) dari Modul Ajar berjudul "${modul.title}".
Materi yang dihasilkan harus setara dengan isi buku pelajaran nasional berkualitas tinggi dan dapat langsung digunakan dalam Modul Ajar maupun Buku Panduan Guru.

Tujuan Pembelajaran (TP): ${modul.tpStatement}
Kriteria Ketercapaian Tujuan Pembelajaran (KKTP): [Anda yang merumuskan dan menganalisis kriteria ketercapaian secara komprehensif berdasarkan TP di atas]
Jenjang: ${modul.targetStudents}
Rencana Kegiatan Pembelajaran per Pertemuan (SEBAGAI ACUAN SINKRONISASI SAJA):
${meetingDetails}

PENTING & WAJIB:
1. Anda DILARANG KERAS menyertakan kembali daftar Rencana Kegiatan Pembelajaran per Pertemuan atau langkah-langkah pembelajaran di dalam isi dokumen Materi Ajar ini. Langkah tersebut sepenuhnya DIHILANGKAN dari output karena sudah ada di Modul Ajar utama.
2. Seluruh pembahasan materi ajar WAJIB disesuaikan secara presisi dan sinkron dengan alur kegiatan pembelajaran di setiap sesi pertemuan di atas.
3. Output WAJIB disajikan dalam format HTML murni (menggunakan tag seperti <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <b>, <i>, <blockquote>, tanpa melilit dengan markup markdown) yang rapi, menarik, dan terstruktur.

Ikuti ketentuan penulisan berikut dengan sangat disiplin:
1. Analisis terlebih dahulu Tujuan Pembelajaran (TP).
2. Analisis KKTP sehingga seluruh indikator dalam KKTP tercakup pada materi pelajaran yang dibuat.
3. Susun materi secara sistematis dari konsep yang paling sederhana menuju konsep yang lebih kompleks.
4. Gunakan bahasa Indonesia yang baku, komunikatif, mudah dipahami peserta didik, tetapi tetap ilmiah.
5. Materi harus lengkap, tidak boleh terlalu singkat, tidak boleh disingkat, dan tidak hanya berupa poin-poin.
6. Jelaskan setiap konsep menggunakan paragraf yang rinci, kaya informasi, dan teoritis.
7. Berikan contoh nyata yang dekat dengan kehidupan peserta didik.
8. Berikan ilustrasi kasus yang kontekstual.
9. Hubungkan materi dengan kondisi lingkungan sekitar siswa.
10. Sertakan fakta-fakta terbaru yang relevan.
11. Gunakan pendekatan pembelajaran aktif.
12. Setiap submateri harus memiliki contoh dan penjelasan yang matang.
13. Materi harus mendukung pembelajaran diferensiasi (berikan penjelasan yang dapat memfasilitasi berbagai kesiapan belajar siswa).
14. Materi harus mendukung pembelajaran mendalam (Deep Learning) untuk merangsang berpikir kritis dan analisis tingkat tinggi.
15. Materi harus memuat pengetahuan faktual, konseptual, prosedural, dan metakognitif.
16. Apabila materi berkaitan dengan IPS, hubungkan secara erat dengan kondisi Indonesia.
17. Jika materi berkaitan dengan IPA, gunakan penjelasan ilmiah yang benar dan presisi.
18. Jika materi berkaitan dengan Matematika, sertakan langkah penyelesaian secara detail dan terstruktur.
19. Hindari penjelasan yang terlalu singkat. Jangan membuat materi dalam bentuk ringkasan pendek.
20. WAJIB MENYERTAKAN DIAGRAM/ILUSTRASI MATERI: Sertakan diagram konseptual menggunakan elemen <svg> inline yang bergaya modern/pastel, atau menyisipkan tag <img> Unsplash yang spesifik dengan topik materi ini (contoh: ilustrasi eksperimen sains, peta, atau diagram alir). Pastikan ada referrerpolicy="no-referrer" di tag img.

Output WAJIB mengikuti format HTML terstruktur berikut (gantikan nilai di dalam tanda kurung siku [] dengan konten materi riil):

<h1>[Judul Materi]</h1>

<h2>A. Apersepsi</h2>
<p>[Uraikan pengantar mendalam yang menghubungkan pengalaman peserta didik dengan materi yang akan dipelajari.]</p>

<h2>B. Tujuan Pembelajaran</h2>
<p>Tujuan Pembelajaran: ${modul.tpStatement}</p>
<p>Kriteria Ketercapaian Tujuan Pembelajaran (KKTP): [Sebutkan indikator-indikator ketercapaian tujuan pembelajaran yang Anda rumuskan secara konkret dan terukur di sini]</p>

<h2>C. Peta Konsep</h2>
<p>[Buat peta konsep dalam bentuk hierarki daftar terstruktur yang jelas, dan sertakan gambar/diagram SVG/Unsplash pendukung di sini.]</p>

<h2>D. Materi Inti</h2>

[Untuk setiap submateri yang relevan dengan TP dan KKTP, buat struktur berikut secara lengkap dan mendalam:]
<h3>[Nama Submateri]</h3>
<p><b>Pengertian:</b> [Uraikan pengertian secara lengkap dalam bentuk paragraf akademik]</p>
<div style="background-color:#f0fdf4; border-left:4px solid #16a34a; padding:8px 12px; margin:8px 0; border-radius:4px;">
  <b>💡 Penjelasan Bahasa Sederhana (Agar Siswa Mudah Mengerti):</b><br/>
  [Jelaskan konsep di atas menggunakan bahasa yang sangat sederhana, santai, komunikatif, dan analogi sehari-hari agar siswa langsung paham maksudnya dengan mudah]
</div>
<p><b>Konsep Dasar:</b> [Penjelasan teori pendukung dan konsep dasar secara mendalam]</p>
<p><b>Penjelasan Lengkap:</b> [Penjelasan teoritis yang sangat mendalam, kaya penjelasan ilmiah, tidak diringkas, berupa paragraf-paragraf terperinci yang menjelaskan mengapa dan bagaimana konsep ini terjadi]</p>
<div style="background-color:#f0fdf4; border-left:4px solid #16a34a; padding:8px 12px; margin:8px 0; border-radius:4px;">
  <b>💡 Penjelasan Bahasa Sederhana Cara Kerja / Prosedur:</b><br/>
  [Penjelasan cara kerja atau prosedur di atas dengan bahasa sederhana dan contoh gampang yang dekat dengan kehidupan siswa]
</div>
<p><b>Fakta Penting:</b> [Sajikan fakta faktual/ilmiah terkini terkait konsep ini]</p>
<p><b>Contoh:</b> [Berikan contoh konkret dalam kehidupan sehari-hari]</p>
<p><b>Ilustrasi:</b> [Berikan analogi atau ilustrasi penjelasan yang mudah dicerna]</p>
<p><b>Studi Kasus:</b> [Uraikan sebuah studi kasus nyata atau fiktif kontekstual yang dapat dianalisis siswa]</p>
<p><b>Analisis:</b> [Sajikan hasil analisis ilmiah/akademis terhadap studi kasus di atas]</p>
<p><b>Hubungan dengan Kehidupan Sehari-hari:</b> [Jelaskan relevansi langsung materi ini dengan keseharian siswa]</p>
<p><b>Kesalahan yang Sering Terjadi:</b> [Identifikasi miskonsepsi atau kesalahan umum siswa dalam memahami konsep ini beserta pelurusannya]</p>
<p><b>Tips Memahami Materi:</b> [Tuliskan tips praktis, metode jembatan keledai, atau cara berpikir sistematis untuk mempermudah pemahaman konsep]</p>

<h2>E. Istilah Penting</h2>
<p>[Berikan glosarium komprehensif berisi istilah-istilah ilmiah/sulit beserta definisi lengkapnya yang dipelajari dalam materi ini.]</p>

<h2>F. Rangkuman</h2>
<p>[Sajikan rangkuman yang komprehensif, padat materi, dan merangkum seluruh poin penting di atas tanpa mengurangi esensi keilmuan.]</p>

<h2>G. Hubungan Materi dengan TP dan KKTP</h2>
<p>[Berikan refleksi metakognitif dan penjelasan teoretis mengenai bagaimana materi yang dijabarkan di atas secara erat mendukung pencapaian TP dan pemenuhan seluruh indikator KKTP.]</p>`;
  return await generateSimpleText(prompt);
}

export async function generateLKPD(modul: ModulAjar): Promise<string> {
  const meetingDetails = modul.meetingActivities?.map(ma => {
    const stepsStr = ma.steps?.map(s => `- [${s.phase}] ${s.activity}`).join('\n') || '';
    return `Pertemuan Ke-${ma.session}: ${ma.activityTitle}\nLangkah Kegiatan:\n${stepsStr}`;
  }).join('\n\n') || '';

  const prompt = `Anda adalah ahli kurikulum ahli pengembang Lembar Kegiatan Siswa. Buat Lembar Kerja Peserta Didik (LKPD) yang berdiferensiasi secara sangat lengkap, detail, dan sistematis untuk Modul Ajar berjudul "${modul.title}".

Tujuan Pembelajaran: ${modul.tpStatement}
Model Pembelajaran: ${modul.model}
Strategi Diferensiasi: ${modul.differentiation}
Rencana Kegiatan Pembelajaran per Pertemuan (SEBAGAI ACUAN SINKRONISASI SAJA):
${meetingDetails}

PENTING & WAJIB:
1. Anda DILARANG KERAS menyertakan kembali daftar Rencana Kegiatan Pembelajaran per Pertemuan atau langkah-langkah pembelajaran di dalam isi dokumen LKPD ini. Langkah tersebut sepenuhnya DIHILANGKAN dari output karena sudah ada di Modul Ajar utama.
2. Setiap LKPD per pertemuan WAJIB disesuaikan secara presisi dan sinkron dengan jenis aktivitas (misal diskusi, analisis, unjuk kerja kelompok) yang dirancang di setiap sesi pertemuan di atas.

Instruksi Pembuatan Mandat Spesifik:
1. **LKPD Berjenjang per Pertemuan**: Sediakan panduan pengerjaan khusus untuk Pertemuan 1, Pertemuan 2, dst. Setiap bagian LKPD tidak boleh hanya berupa perintah satu baris, namun harus mencakup:
   - **Tujuan Aktivitas**: Apa target kerja yang ingin dicapai siswa.
   - **Alat & Bahan / Sumber Belajar**: Daftar hal-hal yang perlu disiapkan siswa di kelas.
   - **Langkah-langkah Kerja Eksploratif**: Instruksi runtut bagaimana siswa berdiskusi, bereksperimen, atau melakukan telaah pustaka.
   - **Tabel Isian Hasil Pengamatan**: Tabel kerja yang dikosongkan agar siswa dapat langsung mengisikan data observasi atau gagasan mereka di kelas.
   - **Pertanyaan Pemandu Diskusi**: Minimal 3 sampai 5 pertanyaan bernalar kritis mengenai pengolahan data atau penyimpulan hasil kerja.
2. **Diferensiasi Tugas**: Pisahkan atau sediakan petunjuk alternatif bagi kategori siswa (misal: Kelompok Belajar Mandiri, Kelompok yang Butuh Bimbingan Tambahan, kelompok pengayaan) di akhir LKPD agar strategi diferensiasi berjalan nyata.

WAJIB - DIAGRAM & LEMBAR ISIAN VISUAL:
Model LKPD harus interaktif dan profesional! Jika penugasan melibatkan diagram/pengisian bagan (misal siklus air, peta pikiran, atau tabel pengamatan), buatlah visualisasi berupa <svg> yang atraktif untuk dianalisis siswa, atau sediakan tabel/ruang kosong yang atraktif. Jikalau butuh ilustrasi foto pendukung kegiatan praktikum, gunakan tag <img> dengan foto Unsplash yang relevan (sertakan referrerpolicy="no-referrer").

Sajikan LKPD per tahapan lengkap dengan ruang jawaban dalam format HTML murni (gunakan tag seperti <h3>, <p>, <ul>, <ol>, <li>, <b> tanpa melilit dengan markup markdown).`;
  return await generateSimpleText(prompt);
}

async function generateSimpleText(prompt: string): Promise<string> {
  const schema = {
    type: Type.OBJECT,
    properties: {
      result: { type: Type.STRING, description: "Teks HTML konten murni yang dihasilkan AI" }
    },
    required: ["result"]
  };

  const requestBody = JSON.stringify({
    prompt,
    schema
  });

  const response = await robustFetch("/api/openai/generate-simple", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody,
  }).catch(err => {
    throw new Error(`Koneksi terputus: ${err.message}`);
  });

  if (!response.ok) {
    const errorData = await parseResponseJson(response).catch(() => ({}));
    throw new Error(errorData.error || "Layanan AI tidak merespon.");
  }

  const { text } = await parseResponseJson(response);
  if (!text) throw new Error("AI tidak memberikan respon.");
  
  const parsed = safeParseJson(text);
  return parsed.result || "";
}
export async function generateModulAjarFromATP(
  atpItem: ATPItem,
  phase: string,
  jpPerWeek: number,
  subject?: string
): Promise<ModulAjar> {
    const prompt = `
    Buatlah MODUL AJAR (RPP) PROFESIONAL DAN SANGAT DETAIL dalam format "Pembelajaran Mendalam (Deep Learning) 8-3-3-4".
    
    Pedoman Struktur Pembelajaran Mendalam (Deep Learning) 8-3-3-4:
    Anda WAJIB menyusun modul ini berdasarkan formula terstruktur 8-3-3-4 secara eksplisit:
    1. 8 DIMENSI PROFIL LULUSAN:
       - Pilih secara otomatis 2-3 dimensi yang paling relevan dengan topik (dari: Keimanan & Ketakwaan, Kewargaan, Penalaran Kritis, Kreativitas, Kolaborasi, Kemandirian, Kesehatan, Komunikasi).
       - Tuliskan dimensi ini di bagian awal modul (field "ppp") sebagai target karakter siswa. (SANGAT PENTING: JANGAN menyertakan awalan 'Profil Lulusan:' atau 'Profil Lulusan ' ke dalam nilai/elemen di field "ppp". Cukup isi dengan nama dimensinya langsung saja, misalnya: "Keimanan & Ketakwaan", "Penalaran Kritis", "Kreativitas", dsb.).
    2. 3 PRINSIP BELAJAR:
       - Modul harus mencerminkan suasana: Berkesadaran (mindful, fokus), Bermakna (relevan dengan hidup siswa), dan Menggembirakan (interaktif, aman secara psikologis).
    3. 3 PENGALAMAN BELAJAR & 4 KERANGKA PEMBELAJARAN (INTEGRASI WAJIB):
       Anda harus menstrukturkan kegiatan belajar menggunakan 4 Kerangka Pembelajaran, di mana 3 Pengalaman Belajar wajib disisipkan di dalamnya secara operasional:
       - **MULAI** (Masuk dalam bagian Pendahuluan): Tuliskan aktivitas pembukaan berupa pertanyaan pemantik esensial DAN aktivitas membangun "Berkesadaran/Mindfulness" singkat (1-2 menit) agar siswa fokus (misalnya bernapas dengan berkesadaran, hening sejenak, atau mengamati sesuatu dengan penuh kesadaran).
       - **DALAMI** (Masuk dalam bagian Kegiatan Inti): Tuliskan langkah eksplorasi materi secara mendalam. Di tahap ini, sisipkan unsur "Empati" (misal: diskusi kelompok menghargai pendapat, menganalisis masalah sosial/lingkungan di sekitar mereka).
       - **SIMPULKAN** (Masuk dalam bagian Kegiatan Inti): Tuliskan panduan agar siswa mampu merangkum materi secara mandiri melalui produk pemahaman konkret (peta pikiran, poster, kalimat kesimpulan). Ini adalah pemenuhan aspek "Pemberian Makna".
       - **TERAPKAN** (Masuk dalam bagian Kegiatan Inti): Tuliskan instruksi aksi nyata atau proyek mini kontekstual di mana siswa menguji pemahaman mereka pada situasi baru di kehidupan sehari-hari.
    4. REFLEKSI (Bagian Penutup):
       - Wajib menyertakan minimal 3 pertanyaan refleksi untuk siswa dan 2 pertanyaan refleksi untuk guru guna mengevaluasi proses belajar (Aspek Refleksi dari 3 Pengalaman Belajar).

    Patuhi pedoman terbaru dari BSKAP Kemdikbudristek tentang Panduan Pembelajaran dan Asesmen Kurikulum Merdeka.
    ${subject ? `Mata Pelajaran: ${subject}\nWAJIB: Seluruh konten modul harus sangat sesuai untuk mata pelajaran ${subject}.` : ''}
    Kelas/Fase: Kelas ${atpItem.classLevel} / Fase ${phase}
    
    KONTEKS ATP:
    Capaian Pembelajaran (CP) Asal: ${atpItem.cp || ''}
    Tujuan Pembelajaran: ${atpItem.tpStatement}
    Indikator Ketercapaian (KKTP): ${atpItem.indikatorTp.map(ind => `${ind.indikator}: ${ind.kktp.join(', ')}`).join('; ')}
    Materi Inti: ${atpItem.content}
    Sumber Belajar (Media) terpilih dari ATP: ${atpItem.resources?.join(', ') || ''}
    Jumlah JP (Alokasi) untuk Modul ini: ${atpItem.jp} JP (Dalam ${atpItem.numberOfMeetings} kali pertemuan. Asumsi ${jpPerWeek} JP per minggu/pertemuan)
    
    INSTRUKES UTAMA PENYUSUNAN ACARA PEMBELAJARAN (WAJIB DIPATUHI SECARA EKSPLISIT):
    1. Tentukan MODEL PEMBELAJARAN (LearningModel) terbaik yang PALING SESUAI dengan karakteristik Materi Inti tersebut. (Pilih salah satu: Problem Based Learning (PBL), Project Based Learning (PjBL), Inquiry Learning, Discovery Learning, atau Cooperative Learning). WAJIB TEPAT. Letakkan nama model ini di field "model".
    2. Bagian "media" (Sarana dan Prasarana / Media Pembelajaran): Isi field "media" di bawah harus diadaptasi secara eksplisit berdasarkan "Sumber Belajar (Media) terpilih dari ATP" di atas. JANGAN mengabaikan media/alat yang sudah ditentukan di ATP.
    3. Modul ini digunakan untuk total waktu ${atpItem.jp} JP (sekitar ${atpItem.numberOfMeetings} pertemuan). Bagi langkah-langkah tersebut menjadi beberapa pertemuan dan masukkan ke dalam array "meetingActivities".
       **PERHATIAN KRUSIAL**: Anda WAJIB menggunakan nilai 'numberOfMeetings' yang DITERIMA DARI KONTEKS ATP (${atpItem.numberOfMeetings}) sebagai jumlah pertemuan mutlak di modul ini. JANGAN mengubah jumlah pertemuan.
       Masing-masing "meetingActivities" harus memiliki:
       - "session": dari angka 1 hingga ${atpItem.numberOfMeetings}
       - "activityTitle": Fokus atau topik spesifik apa yang akan dipelajari pada pertemuan ini.
       - "steps": AKTIVITAS HARUS SANGAT RINCI DAN LENGKAP! Langkah-langkah kegiatan belajar di sesi tersebut WAJIB dibagi menjadi TEPAT 3 elemen/item saja di dalam array "steps" secara berurutan, yaitu: "Pendahuluan", "Kegiatan Inti", dan "Penutup". JANGAN MEMBUAT LEBIH DARI 3 ITEM ATAU MEMECAH KEGIATAN INI MENJADI BANYAK ITEM. Ketiga item tersebut dijabarkan dengan ketentuan berikut:
         
         a) **Pendahuluan** (Hanya dibuat SATU fase/elemen dalam array "steps"):
            - **WAJIB MENCAKUP**: Guru melakukan **Salam pembuka**, **Membuka kegiatan dengan Doa**, melakukan kehadiran siswa, melakukan **Apersepsi** yang relevan dengan materi, serta **Guru menyampaikan Tujuan Pembelajaran** secara jelas kepada siswa.
            - **MULAI (Mindfulness & Pemantik)**: Wajib menyertakan aktivitas pembukaan berupa pertanyaan pemantik esensial DAN aktivitas membangun "Berkesadaran/Mindfulness" singkat (1-2 menit) agar siswa fokus (misalnya bernapas dengan berkesadaran, hening sejenak, atau mengamati sesuatu dengan penuh kesadaran).
            - **Pertanyaan Pemantik**: Pertanyaan Pemantik wajib dicantumkan secara eksplisit dalam langkah kegiatan (diletakkan di bagian Pendahuluan). **SANGAT PENTING: Pertanyaan pemantik yang dibahas di langkah kegiatan ini harus sama persis dengan daftar pertanyaan pemantik yang Anda buat di field 'triggerQuestions' (Komponen Inti). Jangan ada perbedaan kalimat atau menambahkan pertanyaan baru yang tidak terdaftar di 'triggerQuestions'.**
         
         b) **Kegiatan Inti** (Hanya dibuat SATU fase/elemen dalam array "steps" - JANGAN dipecah menjadi beberapa elemen):
             - **WAJIB MENCAKUP SINTAKS MODEL PEMBELAJARAN & KERANGKA 8-3-3-4**: Gabungkan dan jabarkan seluruh langkah-langkah kegiatan inti secara terperinci tahap demi tahap sesuai dengan seluruh sintaks/fase asli dari Model Pembelajaran yang dipilih (PBL, PjBL, Inquiry, Discovery, atau Cooperative), dengan mengintegrasikan secara operasional kerangka:
               * **DALAMI** (Langkah eksplorasi materi secara mendalam. Di tahap ini, sisipkan unsur "Empati" seperti menghargai perbedaan pendapat dalam kelompok, atau menganalisis masalah sosial/lingkungan di sekitar siswa).
               * **SIMPULKAN** (Panduan agar siswa mampu merangkum materi secara mandiri melalui produk pemahaman konkret seperti peta pikiran, poster, atau kalimat kesimpulan sebagai wujud "Pemberian Makna").
               * **TERAPKAN** (Instruksi aksi nyata atau proyek mini kontekstual di mana siswa menguji pemahaman mereka pada situasi baru di kehidupan sehari-hari).
             - **AKTIVITAS GURU DAN SISWA**: Pada setiap fase sintaks, tuliskan dengan sangat jelas dan terpisah tentang **Apa yang harus dilakukan Guru** (instruksional, bimbingan, fasilitasi) dan **Apa yang harus dilakukan oleh Siswa** (eksplorasi, diskusi, eksperimen, analisis) beserta alokasi waktu menitnya. JANGAN membuat kalimat singkat/umum.
             - **Diferensiasi**: Pastikan ada implementasi strategi diferensiasi proses/konten yang terintegrasi secara praktis dalam langkah kegiatan inti ini.
         
         c) **Penutup** (Hanya dibuat SATU fase/elemen dalam array "steps"):
            - **WAJIB MENCAKUP**: Melakukan **Refleksi** bersama antara guru dan siswa dengan menyertakan minimal 3 pertanyaan refleksi untuk siswa dan 2 pertanyaan refleksi untuk guru guna mengevaluasi proses belajar (Aspek Refleksi dari 3 Pengalaman Belajar), merumuskan **Kesimpulan** materi secara mendalam, serta ditutup dengan **Doa pulang/Doa penutup** dan salam.
         
         ATURAN FORMAT PENULISAN LANGKAH KEGIATAN PEMBELAJARAN (SANGAT KRUSIAL & WAJIB PRESISI):
         - Di setiap field 'activity' untuk 'steps', Anda **WAJIB** menuliskan rangkaian rincian rute aktivitas belajar mengajar dalam bentuk **daftar penomoran berurutan dari atas ke bawah (mulai 1, 2, 3, dst.)**.
         - Setiap nomor aktivitas **WAJIB** dilengkapi dengan alokasi estimasi waktu spesifik di dalam tanda kurung, misalnya: '(... menit)'.
         - **WAJIB PENANDAAN FORMULA 8-3-3-4 (SANGAT PRESISI & WAJIB ADA DI SETIAP BARIS)**: Anda **WAJIB** menandai setiap baris rincian aktivitas pembelajaran di Pendahuluan, Kegiatan Inti, maupun Penutup menggunakan tag dalam kurung siku di awal baris yang relevan dengan bagian formula 8-3-3-4 yang diimplementasikan. Tentukan dimensi formula 8-3-3-4 secara sangat akurat dan relevan dengan isi kalimat kegiatannya. Gunakan pilihan tag berikut secara eksplisit:
           - Untuk **Profil Lulusan**: Gunakan [Profil Lulusan: Keimanan & Ketakwaan], [Profil Lulusan: Kewargaan], [Profil Lulusan: Penalaran Kritis], [Profil Lulusan: Kreativitas], [Profil Lulusan: Kolaborasi], [Profil Lulusan: Kemandirian], [Profil Lulusan: Kesehatan], atau [Profil Lulusan: Komunikasi].
           - Untuk **Prinsip Belajar**: Gunakan [Prinsip: Berkesadaran], [Prinsip: Bermakna], atau [Prinsip: Menggembirakan]
           - Untuk **Kerangka Pembelajaran (4 Kerangka)**: Gunakan [Kerangka: Mulai], [Kerangka: Dalami], [Kerangka: Simpulkan], atau [Kerangka: Terapkan]
           - Untuk **Pengalaman Belajar (3 Pengalaman)**: Gunakan [Pengalaman: Berkesadaran], [Pengalaman: Empati], or [Pengalaman: Pemberian Makna]
         - Contoh format penulisan 'activity' pada Pendahuluan/Kegiatan Inti/Penutup:
           1. [Prinsip: Berkesadaran][Kerangka: Mulai] Guru membuka pembelajaran dengan salam santun dan mengajak siswa berdoa bersama dipimpin ketua kelas untuk memusatkan fokus (3 menit).
           2. [Prinsip: Berkesadaran][Pengalaman: Berkesadaran] Guru memimpin latihan mindfulness pernapasan dalam (STOP) selama 2 menit agar siswa siap belajar (2 menit).
           3. [Prinsip: Bermakna][Kerangka: Mulai] Guru memberikan apersepsi menyenangkan dengan mengajukan pertanyaan pemantik kontekstual (5 menit).
           4. [Kerangka: Dalami][Pengalaman: Empati] Siswa berdiskusi kelompok dengan empati untuk menganalisis isu sosial yang relevan (15 menit).
           5. [Kerangka: Simpulkan][Pengalaman: Pemberian Makna] Siswa menyusun peta pikiran mandiri untuk menyimpulkan konsep utama secara mendalam (10 menit).
           6. [Kerangka: Terapkan] Siswa memikirkan aksi nyata dalam kehidupan sehari-hari (10 menit).
         - Aturan penomoran baris (1, 2, 3...) dan pencantuman waktu per sub-aktivitas serta tag formula 8-3-3-4 di atas adalah **WAJIB MUTLAK** untuk isi Pendahuluan, seluruh sintaks Kegiatan Inti, dan isi Penutup. JANGAN menyajikan teks dalam satu paragraf panjang atau bullet points tanpa tag.
             
     3. Tentukan "duration". Tuliskan "Total ${atpItem.jp} JP (${atpItem.numberOfMeetings} Pertemuan)".
     4. Isi field "targetStudents": "Kelas ${atpItem.classLevel}".
     5. WAJIB MENGGUNAKAN: Capaian Pembelajaran (CP) lengkap dan resmi dari Keputusan BSKAP terbaru (bukan diringkas).
     6. WAJIB MENGGUNAKAN: Profil Lulusan terbaru dari 8 Profil Lulusan (Keimanan & Ketakwaan, Kewargaan, Penalaran Kritis, Kreativitas, Kolaborasi, Kemandirian, Kesehatan, Komunikasi) yang paling relevan. Sertakan Pemahaman Bermakna dan Pertanyaan Pemantik yang relevan dan mendalam.
     6b. **KONSISTENSI PERTANYAAN PEMANTIK (WAJIB MUTLAK)**: Pertanyaan Pemantik yang ditulis dalam array 'triggerQuestions' (Komponen Inti) harus sama persis, kata demi kata, dengan Pertanyaan Pemantik yang dicantumkan dan dibahas di dalam langkah-langkah kegiatan pembelajaran ('meetingActivities' -> 'steps' -> 'activity'). JANGAN menuliskan pertanyaan pemantik yang berbeda antara Komponen Inti dan Kegiatan Pembelajaran.
     7. WAJIB MENGGUNAKAN: KKTP sebagai pernyataan operasional yang terukur (contoh: "Peserta didik mampu menjelaskan...", "Peserta didik mampu mengidentifikasi..."), BUKAN kalimat tanya/soal.
     8. **KORELASI ASESMEN & KEGIATAN**: Seluruh rencana asesmen (formatif, awal, dan sumatif) dalam field "assessment" serta rubrik penilaian dalam field "rubrics" WAJIB sinkron dan disesuaikan secara presisi dengan skenario/langkah kegiatan pembelajaran yang dirancang di tiap sesi pertemuan (misal jika ada diskusi kelompok di Pertemuan 1, sediakan rubrik penilaian diskusi kelompok; jika ada presentasi di Pertemuan 2, sediakan rubrik presentasi; dsb.). JANGAN menggunakan asesmen/rubrik umum yang tidak berkaitan dengan aktivitas pembelajaran di modul ini.
     8b. **PENEMPATAN ASESMEN SUMATIF (WAJIB MUTLAK)**: Jika terdapat Asesmen Sumatif (seperti pengerjaan lembar soal sumatif, tes harian tertulis, presentasi produk akhir, dsb.), maka pelaksanaan kegiatan asesmen sumatif ini **WAJIB dituliskan secara eksplisit** di dalam langkah rincian kegiatan pembelajaran ('meetingActivities' -> 'steps' -> 'activity') pada sesi pertemuan final atau pertemuan yang relevan. Letakkan rincian asesmen sumatif ini di bagian akhir 'Kegiatan Inti' atau di awal bagian 'Penutup' pertemuan tersebut.
     9. **WAJIB MENGGUNAKAN ASESMEN SUMATIF SECARA SPESIFIK & JELAS**: Pada bagian Asesmen Sumatif di field "assessment" dan/atau dalam langkah pembelajaran ("steps"), Anda WAJIB menentukan dan menyebutkan jumlah butir soal secara sangat spesifik dan eksak (contoh: "Asesmen Sumatif tertulis berupa 5 soal pilihan ganda dan 3 soal uraian/esai"). JANGAN menuliskan instrumen evaluasi secara umum tanpa angka kuantitatif/jumlah soal yang jelas.
     10. WAJIB MENGGUNAKAN: Sumber Belajar resmi: Buku IPS SMP Kelas VII Kurikulum Merdeka (Kemendikbud), Portal Rumah Belajar, atau Video Pembelajaran resmi Kemendikbud.
     11. Field "differentiation": Jelaskan dengan SANGAT SPESIFIK bentuk diferensiasi Konten, Proses, dan Produk yang digunakan pada modul ini dalam bentuk poin-poin bernomor urut 1, 2, 3 (misal: "1. Diferensiasi Konten: ... \n2. Diferensiasi Proses: ... \n3. Diferensiasi Produk: ..."). DILARANG DIBUAT PARAGRAF DESKRIPSI TANPA NOMOR.
     12. Field "assessment": WAJIB MENGIKUTI STRUKTUR & FORMAT HIERARKI PENOMORAN DENGAN RAPI BERIKUT KATA DEMI KATA:
Rencana Asesmen:

1. Asesmen Awal: Kuis singkat (5 soal pilihan ganda) untuk mengidentifikasi pemahaman awal siswa tentang [topik/materi] di awal modul.
2. Asesmen Formatif:
   1. Observasi partisipasi aktif siswa dalam diskusi kelompok (Pertemuan ...).
   2. Penilaian produk [peta pikiran/poster/infografis] (Pertemuan ...).
   3. Penilaian presentasi kelompok (Pertemuan ...).
3. Asesmen Sumatif:
   1. Tes tertulis (5 soal pilihan ganda dan 3 soal uraian/esai) pada Pertemuan [pertemuan terakhir] untuk mengukur pemahaman keseluruhan materi.
   2. Penilaian proyek mini '[Nama Proyek Mini]' (Pertemuan ...) untuk mengukur kemampuan penerapan konsep.
     13. Field "rubrics": Buatlah rubrik penilaian yang detail (aspek, skor 1-4, deskripsi) dalam format tabel HTML untuk asesmen formatif dan sumatif yang sinkron dengan langkah pembelajaran.
     
     Output harus berupa JSON murni tanpa spasi/baris baru berlebih di dalam nilai string.
   `;

  try {
    const requestBody = JSON.stringify({ prompt, schema: MODUL_SCHEMA });

    const response = await robustFetch("/api/openai/generate-modul", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }).catch(err => {
      console.error("Fetch modul error details:", err);
      throw new Error(`Koneksi terputus: ${err.message || "Gagal menghubungkan ke server."}`);
    });

    if (!response.ok) {
      let errorMsg = "Gagal membuat modul ajar.";
      try {
        const errorData = await parseResponseJson(response);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        errorMsg = `Server error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMsg);
    }

    const { text } = await parseResponseJson(response);
    if (!text) throw new Error("AI tidak memberikan respon (kosong).");
    
    try {
      const parsed = safeParseJson(text) as ModulAjar;
      parsed.cp = parsed.cp || atpItem.cp;
      if (parsed && Array.isArray(parsed.meetingActivities)) {
        parsed.meetingActivities.sort((a: any, b: any) => (parseInt(a.session) || 0) - (parseInt(b.session) || 0));
      }
      return parsed;
    } catch (parseError: any) {
      console.error("JSON parse error:", parseError, "Raw text:", text);
      throw new Error(`Format respon AI tidak valid: ${parseError.message}`);
    }
  } catch (error: any) {
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('limit')) {
      throw new Error("Batas penggunaan API/Token bulanan telah tercapai. Harap periksa tagihan Anda di OpenAI.");
    }
    throw new Error(error.message || "Gagal membuat modul ajar.");
  }
}

export async function generateModulAjar(
  tp: TujuanPembelajaran, 
  session: number, 
  activity: string, 
  model: LearningModel,
  jpPerWeek?: number,
  subject?: string,
  cp?: string
): Promise<ModulAjar> {
    const prompt = `
    Buatlah MODUL AJAR (RPP) PROFESIONAL DAN SANGAT DETAIL dalam format "Pembelajaran Mendalam (Deep Learning) 8-3-3-4" untuk Pertemuan ke-${session}.
    
    Pedoman Struktur Pembelajaran Mendalam (Deep Learning) 8-3-3-4:
    Anda WAJIB menyusun modul ini berdasarkan formula terstruktur 8-3-3-4 secara eksplisit:
    1. 8 DIMENSI PROFIL LULUSAN:
       - Pilih secara otomatis 2-3 dimensi yang paling relevan dengan topik (dari: Keimanan & Ketakwaan, Kewargaan, Penalaran Kritis, Kreativitas, Kolaborasi, Kemandirian, Kesehatan, Komunikasi).
       - Tuliskan dimensi ini di bagian awal modul (field "ppp") sebagai target karakter siswa. (SANGAT PENTING: JANGAN menyertakan awalan 'Profil Lulusan:' atau 'Profil Lulusan ' ke dalam nilai/elemen di field "ppp". Cukup isi dengan nama dimensinya langsung saja, misalnya: "Keimanan & Ketakwaan", "Penalaran Kritis", "Kreativitas", dsb.).
    2. 3 PRINSIP BELAJAR:
       - Modul harus mencerminkan suasana: Berkesadaran (mindful, fokus), Bermakna (relevan dengan hidup siswa), dan Menggembirakan (interaktif, aman secara psikologis).
    3. 3 PENGALAMAN BELAJAR & 4 KERANGKA PEMBELAJARAN (INTEGRASI WAJIB):
       Anda harus menstrukturkan kegiatan belajar menggunakan 4 Kerangka Pembelajaran, di mana 3 Pengalaman Belajar wajib disisipkan di dalamnya secara operasional:
       - **MULAI** (Masuk dalam bagian Pendahuluan): Tuliskan aktivitas pembukaan berupa pertanyaan pemantik esensial DAN aktivitas membangun "Berkesadaran/Mindfulness" singkat (1-2 menit) agar siswa fokus (misalnya bernapas dengan berkesadaran, hening sejenak, atau mengamati sesuatu dengan penuh kesadaran).
       - **DALAMI** (Masuk dalam bagian Kegiatan Inti): Tuliskan langkah eksplorasi materi secara mendalam. Di tahap ini, sisipkan unsur "Empati" (misal: diskusi kelompok menghargai pendapat, menganalisis masalah sosial/lingkungan di sekitar mereka).
       - **SIMPULKAN** (Masuk dalam bagian Kegiatan Inti): Tuliskan panduan agar siswa mampu merangkum materi secara mandiri melalui produk pemahaman konkret (peta pikiran, poster, kalimat kesimpulan). Ini adalah pemenuhan aspek "Pemberian Makna".
       - **TERAPKAN** (Masuk dalam bagian Kegiatan Inti): Tuliskan instruksi aksi nyata atau proyek mini kontekstual di mana siswa menguji pemahaman mereka pada situasi baru di kehidupan sehari-hari.
    4. REFLEKSI (Bagian Penutup):
       - Wajib menyertakan minimal 3 pertanyaan refleksi untuk siswa dan 2 pertanyaan refleksi untuk guru guna mengevaluasi proses belajar (Aspek Refleksi dari 3 Pengalaman Belajar).

    Patuhi pedoman terbaru dari BSKAP Kemdikbudristek tentang Panduan Pembelajaran dan Asesmen Kurikulum Merdeka.
    ${subject ? `Mata Pelajaran: ${subject}` : ''}
    Kelas/Fase: Kelas ${tp.classLevel}
    
    KONTEKS:
    ${cp ? `Capaian Pembelajaran (CP) Asal: ${cp}` : ''}
    Tujuan Pembelajaran: ${tp.statement}
    Kriteria (KKTP): ${tp.indikatorTp.map(ind => `${ind.indikator}: ${ind.kktp.join(', ')}`).join('; ')}
    Aktivitas Fokus: ${activity}
    Model Pembelajaran yang Diminta: ${model}
    ${jpPerWeek ? `Alokasi Waktu Mata Pelajaran: ${jpPerWeek} JP per minggu.` : ''}
    
    INSTRUKSI UTAMA PENYUSUNAN ACARA PEMBELAJARAN (WAJIB DIPATUHI SECARA EKSPLISIT):
    1. Elaborasi aktivitas fokus menjadi langkah-langkah pembelajaran yang SANGAT RINCI, DINAMIS, dan PROFESIONAL. Masukkan rincian kegiatan ini ke dalam array "meetingActivities" dengan "session" diisi ${session}. Langkah-langkah kegiatan belajar di sesi tersebut WAJIB dibagi menjadi TEPAT 3 elemen/item saja di dalam array "steps" secara berurutan, yaitu: "Pendahuluan", "Kegiatan Inti", dan "Penutup". JANGAN MEMBUAT LEBIH DARI 3 ITEM ATAU MEMECAH KEGIATAN INI MENJADI BANYAK ITEM. Ketiga item tersebut dijabarkan dengan ketentuan berikut:
       
       a) **Pendahuluan** (Hanya dibuat SATU fase/elemen dalam array "steps"):
          - **WAJIB MENCAKUP**: Guru melakukan **Salam pembuka**, **Membuka kegiatan dengan Doa**, memeriksa kehadiran siswa, melakukan **Apersepsi** hangat yang relevan dengan materi, serta **Guru menyampaikan Tujuan Pembelajaran** yang akan dicapai secara jelas kepada siswa.
          - **MULAI (Mindfulness & Pemantik)**: Wajib menyertakan aktivitas pembukaan berupa pertanyaan pemantik esensial DAN aktivitas membangun "Berkesadaran/Mindfulness" singkat (1-2 menit) agar siswa fokus (misalnya bernapas dengan berkesadaran, hening sejenak, atau mengamati sesuatu dengan penuh kesadaran).
          - **Pertanyaan Pemantik**: Pertanyaan Pemantik wajib dicantumkan secara eksplisit dalam langkah kegiatan (diletakkan di bagian Pendahuluan). **SANGAT PENTING: Pertanyaan pemantik yang dibahas di langkah kegiatan ini harus sama persis dengan daftar pertanyaan pemantik yang Anda buat di field 'triggerQuestions' (Komponen Inti). Jangan ada perbedaan kalimat atau menambahkan pertanyaan baru yang tidak terdaftar di 'triggerQuestions'.**
       
       b) **Kegiatan Inti** (Hanya dibuat SATU fase/elemen dalam array "steps" - JANGAN dipecah menjadi beberapa elemen):
          - **WAJIB MENCAKUP SINTAKS MODEL PEMBELAJARAN & KERANGKA 8-3-3-4**: Gabungkan dan jabarkan seluruh langkah-langkah kegiatan inti secara terperinci tahap demi tahap sesuai dengan seluruh sintaks/fase asli dari Model Pembelajaran yang diminta (${model}) ke dalam SATU item/fase "Kegiatan Inti" ini saja, dengan mengintegrasikan secara operasional kerangka:
            * **DALAMI** (Langkah eksplorasi materi secara mendalam. Di tahap ini, sisipkan unsur "Empati" seperti menghargai perbedaan pendapat dalam kelompok, atau menganalisis masalah sosial/lingkungan di sekitar siswa).
            * **SIMPULKAN** (Panduan agar siswa mampu merangkum materi secara mandiri melalui produk pemahaman konkret seperti peta pikiran, poster, atau kalimat kesimpulan sebagai wujud "Pemberian Makna").
            * **TERAPKAN** (Instruksi aksi nyata atau proyek mini kontekstual di mana siswa menguji pemahaman mereka pada situasi baru di kehidupan sehari-hari).
          - **AKTIVITAS GURU DAN SISWA**: Pada setiap fase sintaks, jelaskan dengan sangat rinci tentang **Apa yang harus dilakukan Guru** (membimbing, mengamati, memandu diskusi, memberikan scaffolding) dan **Apa yang harus dilakukan oleh Siswa** (bekerja kelompok, menganalisis data, mempresentasikan hasil, melakukan eksplorasi mandiri) beserta waktu pengerjaannya (dalam menit). Hindari generalisasi umum.
          - **Diferensiasi**: Pastikan ada implementasi strategi diferensiasi proses/konten yang terintegrasi di dalam kegiatan inti ini.
          - **RUBRIK PENILAIAN HARIAN**: WAJIB sertakan rubrik penilaian harian (format tabel) untuk kegiatan di pertemuan ini.
       
       c) **Penutup** (Hanya dibuat SATU fase/elemen dalam array "steps"):
          - **WAJIB MENCAKUP**: Guru dan siswa bersama-sama melakukan **Refleksi** pembelajaran dengan menyertakan minimal 3 pertanyaan refleksi untuk siswa dan 2 pertanyaan refleksi untuk guru guna mengevaluasi proses belajar (Aspek Refleksi dari 3 Pengalaman Belajar), merumuskan **Kesimpulan** materi yang bermakna dan mendalam, serta ditutup dengan **Doa pulang/Doa penutup** dan salam hangat.
         
        ATURAN FORMAT PENULISAN LANGKAH KEGIATAN PEMBELAJARAN (SANGAT KRUSIAL):
        - Di setiap field 'activity' untuk 'steps', Anda **WAJIB** menuliskan rangkaian rincian rute aktivitas belajar mengajar dalam bentuk **daftar penomoran berurutan dari atas ke bawah (mulai 1, 2, 3, dst.)**.
        - Setiap nomor aktivitas **WAJIB** dilengkapi dengan alokasi estimasi waktu spesifik di dalam tanda kurung, misalnya: '(... menit)'.
        - **WAJIB PENANDAAN FORMULA 8-3-3-4 (SANGAT PRESISI & WAJIB ADA DI SETIAP BARIS)**: Anda **WAJIB** menandai setiap baris rincian aktivitas pembelajaran di Pendahuluan, Kegiatan Inti, maupun Penutup menggunakan tag dalam kurung siku di awal baris yang relevan dengan bagian formula 8-3-3-4 yang diimplementasikan. Tentukan dimensi formula 8-3-3-4 secara sangat akurat dan relevan dengan isi kalimat kegiatannya. Gunakan pilihan tag berikut secara eksplisit:
          - Untuk **Profil Lulusan**: Gunakan [Profil Lulusan: Keimanan & Ketakwaan], [Profil Lulusan: Kewargaan], [Profil Lulusan: Penalaran Kritis], [Profil Lulusan: Kreativitas], [Profil Lulusan: Kolaborasi], [Profil Lulusan: Kemandirian], [Profil Lulusan: Kesehatan], atau [Profil Lulusan: Komunikasi].
          - Untuk **Prinsip Belajar**: Gunakan [Prinsip: Berkesadaran], [Prinsip: Bermakna], atau [Prinsip: Menggembirakan]
          - Untuk **Kerangka Pembelajaran (4 Kerangka)**: Gunakan [Kerangka: Mulai], [Kerangka: Dalami], [Kerangka: Simpulkan], atau [Kerangka: Terapkan]
          - Untuk **Pengalaman Belajar (3 Pengalaman)**: Gunakan [Pengalaman: Berkesadaran], [Pengalaman: Empati], atau [Pengalaman: Pemberian Makna]
        - Contoh format penulisan 'activity' pada Pendahuluan/Kegiatan Inti/Penutup:
          1. [Prinsip: Berkesadaran][Kerangka: Mulai] Guru membuka pembelajaran dengan salam santun dan mengajak siswa berdoa bersama dipimpin ketua kelas untuk memusatkan fokus (3 menit).
          2. [Prinsip: Berkesadaran][Pengalaman: Berkesadaran] Guru memimpin latihan mindfulness pernapasan dalam (STOP) selama 2 menit agar siswa siap belajar (2 menit).
          3. [Prinsip: Bermakna][Kerangka: Mulai] Guru memberikan apersepsi menyenangkan dengan mengajukan pertanyaan pemantik kontekstual (5 menit).
          4. [Kerangka: Dalami][Pengalaman: Empati] Siswa berdiskusi kelompok dengan empati untuk menganalisis isu sosial yang relevan (15 menit).
          5. [Kerangka: Simpulkan][Pengalaman: Pemberian Makna] Siswa menyusun peta pikiran mandiri untuk menyimpulkan konsep utama secara mendalam (10 menit).
          6. [Kerangka: Terapkan] Siswa memikirkan aksi nyata dalam kehidupan sehari-hari (10 menit).
        - Aturan penomoran baris (1, 2, 3...) dan pencantuman waktu per sub-aktivitas serta tag formula 8-3-3-4 di atas adalah **WAJIB MUTLAK** untuk isi Pendahuluan, seluruh sintaks Kegiatan Inti, dan isi Penutup. JANGAN menyajikan teks dalam satu paragraf panjang atau bullet points tanpa tag.
          
     2. Sertakan Tujuan Pembelajaran (tpStatement) dalam bentuk POIN-POIN (bullet points) yang dipisahkan baris baru.
     3. Tentukan "duration" (alokasi waktu per pertemuan). WAJIB TEPAT ${jpPerWeek || 3} JP (Jam Pelajaran). Tulis dalam format "${jpPerWeek || 3} JP".
    4. Isi field "targetStudents" DENGAN TEPAT SESUAI KELAS: "Kelas ${tp.classLevel}".
    5. MUST INCLUDE: Dimensi Profil Lulusan (dari 8 Profil Lulusan), Pemahaman Bermakna, dan Pertanyaan Pemantik.
    5b. **KONSISTENSI PERTANYAAN PEMANTIK (WAJIB MUTLAK)**: Pertanyaan Pemantik yang ditulis dalam array 'triggerQuestions' (Komponen Inti) harus sama persis, kata demi kata, dengan Pertanyaan Pemantik yang dicantumkan dan dibahas di dalam langkah-langkah kegiatan pembelajaran ('meetingActivities' -> 'steps' -> 'activity'). JANGAN menuliskan pertanyaan pemantik yang berbeda antara Komponen Inti dan Kegiatan Pembelajaran.
    6. MUST INCLUDE: Pendekatan Asesmen Awal Pembelajaran (Kognitif/Non-kognitif) pada bagian awal Kegiatan Pembelajaran (Pendahuluan), Asesmen Formatif selama inti pembelajaran, dan atau Asesmen Sumatif. Jika terdapat asesmen sumatif, Anda WAJIB menentukan dan menyebutkan jumlah butir soal secara sangat spesifik dan eksak di dalam deskripsi Asesmen Sumatif (field "assessment") dan/atau langkah pembelajaran (misalnya menuliskan dengan jelas: "Asesmen Sumatif berupa 5 soal pilihan ganda dan 3 soal uraian/esai"). JANGAN menuliskan instrumen evaluasi secara umum tanpa menyebutkan jumlah soal.
    6b. **PENEMPATAN ASESMEN SUMATIF (WAJIB MUTLAK)**: Jika terdapat Asesmen Sumatif pada pertemuan ini, maka pelaksanaan kegiatan asesmen sumatif tersebut (misalnya tes tertulis evaluasi, pengisian lembar evaluasi sumatif, presentasi produk akhir) **WAJIB dituliskan secara eksplisit** di dalam langkah rincian kegiatan pembelajaran ('meetingActivities' -> 'steps' -> 'activity'). Letakkan rincian pelaksanaan asesmen sumatif ini di bagian akhir 'Kegiatan Inti' atau di awal bagian 'Penutup' pertemuan tersebut.
    7. MUST INCLUDE: Implementasi Pembelajaran Berdiferensiasi (Konten/Proses/Produk). Field "differentiation" HARUS mendeskripsikan ini secara jelas dalam bentuk daftar bernomor 1, 2, 3 (DILARANG DIBUAT PARAGRAF DESKRIPSI TANPA NOMOR).
    7b. FORMAT ASESMEN BERMOMOR (WAJIB): Field "assessment" HARUS dituliskan dalam bentuk daftar bernomor 1, 2, 3 (misal: "1. Asesmen Awal: ... \n2. Asesmen Formatif: ... \n3. Asesmen Sumatif: ..."). DILARANG DIBUAT PARAGRAF DESKRIPSI TANPA NOMOR.
    8. **KORELASI ASESMEN & KEGIATAN**: Rencana Asesmen (field "assessment") dan Rubrik Penilaian (field "rubrics") WAJIB disesuaikan secara presisi dengan langkah-langkah kegiatan pembelajaran yang telah rancang untuk sesi pertemuan ini. Rubrik penilaian dalam field 'rubrics' harus menggambarkan rincian kriteria penilaian kegiatan belajar tersebut secara riil (misal rubrik diskusi kelompok, presentasi, atau unjuk kerja proyek yang dirancang di kegiatan inti).


  `;

  try {
    const requestBody = JSON.stringify({ tp, session, activity, model, jpPerWeek, prompt, schema: MODUL_SCHEMA });
    console.log(`[OpenAIService] Request size (Modul): ${(requestBody.length / 1024).toFixed(2)} KB`);

    const response = await robustFetch("/api/openai/generate-modul", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }).catch(err => {
      console.error("Fetch modul error details:", err);
      throw new Error(`Koneksi terputus: ${err.message || "Gagal menghubungkan ke server."}`);
    });

    if (!response.ok) {
      let errorMsg = "Gagal membuat modul ajar.";
      try {
        const errorData = await parseResponseJson(response);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        errorMsg = `Server error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMsg);
    }
    const { text } = await parseResponseJson(response);
    if (!text) throw new Error("AI tidak memberikan respon (kosong).");
    
    const parsed = safeParseJson(text) as ModulAjar;
    parsed.cp = parsed.cp || cp;
    if (parsed && Array.isArray(parsed.meetingActivities)) {
      parsed.meetingActivities.sort((a: any, b: any) => (parseInt(a.session) || 0) - (parseInt(b.session) || 0));
    }
    return parsed;
  } catch (error: any) {
    console.error("OpenAI Modul Error:", error);
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('limit')) {
      throw new Error(error.message);
    }
    throw new Error(error.message || "Gagal membuat Modul Ajar. Silakan coba lagi.");
  }
}

const ATP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tpId: { type: Type.STRING },
          tpStatement: { type: Type.STRING },
          cp: { type: Type.STRING, description: "Potongan Capaian Pembelajaran (CP) yang relevan" },
          element: { type: Type.STRING },
          competency: { type: Type.STRING },
          content: { type: Type.STRING, description: "Konten/Materi pembelajaran" },
          indikatorTp: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                indikator: { type: Type.STRING, description: "Kalimat Indikator Tujuan Pembelajaran yang konkret dan terukur (misal: 'Peserta didik mampu menyebutkan...')" },
                kktp: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Daftar 3-4 Kriteria Ketercapaian (KKTP) menggunakan taksonomi Bloom (C1-C6) khusus untuk indikator ini. Format wajib: '[C1 - Mengingat] Siswa mampu...'"
                }
              },
              required: ["indikator", "kktp"]
            },
            description: "Daftar Indikator Tujuan Pembelajaran, masing-masing dengan KKTP tersendiri"
          },
          jp: { type: Type.NUMBER, description: "Alokasi waktu dalam Jam Pelajaran (JP)" },
          assessment: { type: Type.STRING, description: "Jenis penilaian dan instrumennya" },
          flow: { type: Type.NUMBER, description: "Urutan logis (1, 2, 3...)" },
          resources: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Sumber belajar spesifik" },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Kata-kata kunci materi" },
          p3: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Dimensi Profil Lulusan" },
          classLevel: { type: Type.STRING },
          numberOfMeetings: { type: Type.NUMBER, description: "Jumlah pertemuan yang dibutuhkan untuk TP ini" },
          semester: { type: Type.INTEGER, description: "Semester 1 (Ganjil) atau 2 (Genap)" },
          startWeek: { type: Type.INTEGER, description: "Minggu pelaksanaan dimulai (Semester 1: minggu 1-19 karena hari mengajar lebih banyak, Semester 2: minggu 1-17 karena hari mengajar lebih sedikit)" },
          endWeek: { type: Type.INTEGER, description: "Minggu pelaksanaan berakhir" }
        },
        required: ["tpId", "tpStatement", "cp", "element", "competency", "content", "indikatorTp", "jp", "assessment", "flow", "resources", "keywords", "p3", "classLevel", "numberOfMeetings", "semester", "startWeek", "endWeek"]
      }
    },
    rationale: { type: Type.STRING, description: "Rasionalisasi urutan alur tujuan pembelajaran" }
  },
  required: ["items", "rationale"]
};

export async function generateATP(mapping: MappingResult, jpPerWeek: number, meetingsPerWeek: number, subject?: string): Promise<AlurTujuanPembelajaran> {
  // Extract unique class levels from the mapping
  const classLevels = [...new Set(mapping.tujuanPembelajaran.map(t => t.classLevel))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  
  if (classLevels.length === 0) {
    throw new Error("Tidak ada data Tujuan Pembelajaran untuk disusun.");
  }
  
  const generateForClass = async (classLevel: string) => {
    const tpsForClass = mapping.tujuanPembelajaran.filter(t => t.classLevel === classLevel);
    const tpList = tpsForClass.map(t => `- ID: ${t.id}, TP: ${t.statement}, Elemen: ${t.element}, Kelas: ${t.classLevel}`).join('\n');
    
    const prompt = `
      Anda adalah pakar kurikulum senior Kurikulum Merdeka di Indonesia.
      Tugas: Susunlah ALUR TUJUAN PEMBELAJARAN (ATP) yang SANGAT DETAIL dan LENGKAP untuk Fase ${mapping.phase} Kelas ${classLevel}.
      ${subject ? `Mata Pelajaran: ${subject}` : ''}
      
      KONTEKS:
      Daftar Tujuan Pembelajaran (TP) untuk Kelas ${classLevel}:
      ${tpList}
      
      Alokasi Waktu Mata Pelajaran: ${jpPerWeek} JP per minggu.
      Jumlah Pertemuan per Minggu: ${meetingsPerWeek} pertemuan.
      
      INSTRUKSI PENYUSUNAN ATP PROFESIONAL (TERMASUK PROTA & PROSEM):
      1. Urutkan TP secara logis dan pedagogis (misal: prasyarat -> materi inti -> pengayaan).
      2. WAJIB: PASTIKAN SEMUA TP DALAM DAFTAR DI ATAS MASUK KE DALAM OUTPUT. JANGAN ADA YANG TERLEWAT.
      3. JUMLAH JP & PERTEMUAN (ATURAN MATEMATIS SANGAT KETAT!): 
         - 1 Tahun Ajaran memiliki 36 Minggu efektif, dengan pembagian proporsional di mana Semester 1 (Ganjil) memiliki lebih banyak minggu efektif (yaitu 19 minggu efektif) dibandingkan Semester 2 (Genap) yang memiliki lebih sedikit minggu efektif (yaitu 17 minggu efektif).
         - TOTAL KESELURUHAN field "numberOfMeetings" dari SEMUA TP di Kelas ${classLevel} INI WAJIB MENCAPAI ANGKA 36 (Semester 1 = 19 minggu, Semester 2 = 17 minggu).
         - ATURAN PERHITUNGAN MINGGU (WAJIB DIPATUHI): Jumlah Minggu (numberOfMeetings) = (Total JP per TP / ${jpPerWeek}) * ${meetingsPerWeek}.
         - Hasil pembagian HARUS dibulatkan ke atas jika tidak bulat (Math.ceil).
         - Contoh: Jika Total JP per TP adalah 36, ${jpPerWeek} JP/minggu, dan ${meetingsPerWeek} pertemuan/minggu, maka numberOfMeetings = (36 / ${jpPerWeek}) * ${meetingsPerWeek}.
         - Field "jp" di setiap TP adalah total JP yang dialokasikan untuk TP tersebut.
         - **PERHATIAN KRUSIAL**: Nilai 'numberOfMeetings' (minggu) yang Anda tentukan di ATP INI akan menjadi jumlah minggu MUTLAK yang WAJIB digunakan sebagai dasar perhitungan di Modul Ajar, Prota, dan Prosem. DAN HARUS SAMA DENGAN (endWeek - startWeek + 1).
      4. PROGRAM TAHUNAN & SEMESTER (PROTA/PROSEM):
         - **ATURAN MUTLAK DISTRIBUSI SEMESTER: KEDUA SEMESTER WAJIB MEMILIKI TUJUAN PEMBELAJARAN (TP)!** 
           - Dilarang keras menumpuk semua TP di satu semester saja. Kedua semester (Semester 1 dan Semester 2) masing-masing HARUS memiliki minimal 2 atau lebih TP (atau minimal sepertiga dari total TP yang tersedia).
           - Bagilah daftar TP di atas menjadi 2 bagian secara berurutan: Bagian pertama untuk Semester 1 (Ganjil), dan Bagian kedua untuk Semester 2 (Genap).
           - **KONSISTENSI TOTAL MINGGU**: 
             * Semester 1 dirancang memiliki total kumulatif "numberOfMeetings" tepat 19 minggu efektif. Jadi, jumlahkan 'numberOfMeetings' dari semua TP yang masuk Semester 1, pastikan totalnya harus tepat 19.
             * Semester 2 dirancang memiliki total kumulatif "numberOfMeetings" tepat 17 minggu efektif. Jadi, jumlahkan 'numberOfMeetings' dari semua TP yang masuk Semester 2, pastikan totalnya harus tepat 17.
             * Gabungan kedua semester harus tepat berjumlah 36 minggu efektif (19 + 17 = 36). Sifat dari pembagian ini adalah wajib dan mutlak secara matematis.
         - Hitung startWeek dan endWeek secara kumulatif berdasarkan numberOfMeetings untuk masing-masing semester secara terpisah:
           * Untuk Semester 1: TP pertama dimulai dari startWeek: 1. TP-TP berikutnya melanjutkan secara kumulatif (startWeek = endWeek_sebelumnya + 1) hingga berakhir tepat di endWeek: 19 untuk TP terakhir Semester 1.
           * Untuk Semester 2: TP pertama di Semester 2 harus di-reset kembali dari startWeek: 1. TP-TP berikutnya melanjutkan secara kumulatif hingga berakhir tepat di endWeek: 17 untuk TP terakhir Semester 2.
         - **WAJIB**: Pastikan total jumlah minggu di prosem sesuai dengan total numberOfMeetings. StartWeek dan endWeek harus konsisten dengan jumlah pertemuan.
      5. CP & ELEMEN: 
         - Cantumkan potongan Capaian Pembelajaran (CP) asli yang relevan dengan TP tersebut.
         - Pastikan "element" (nama elemen) sesuai dengan kategori yang sudah ditentukan di TP.
      6. Konten/Materi: Jabarkan materi pembelajaran secara spesifik dan mendalam yang SANGAT RELEVAN.
      7. indikatorTp & KKTP: **SANGAT PENTING & WAJIB**: Setiap Tujuan Pembelajaran (TP) harus dipecah menjadi beberapa **Indikator Tujuan Pembelajaran (indikatorTp)** yang konkret dan terukur.
         - Di dalam field "indikatorTp" (yang berupa array of object), tentukan minimal 2-3 Indikator TP.
         - Untuk **SETIAP** Indikator TP tersebut, susunlah Kriteria Ketercapaian Tujuan Pembelajaran (KKTP) secara mendalam menggunakan Taksonomi Bloom (tingkat kognitif C1 hingga C6) yang relevan dan diturunkan langsung dari indikator tersebut secara kritis.
         - Masukkan KKTP ini ke dalam field "kktp" di dalam objek Indikator TP masing-masing (berupa array of string). Berikan 3-4 kriteria KKTP yang konkret, terukur, dan detail untuk masing-masing indikator.
         - Di setiap butir KKTP, Anda **WAJIB** mencantumkan level/tingkat kognitif Bloom di dalam tanda kurung siku di awal kalimat secara eksplisit, misalnya:
           - "[C1 - Mengingat] Peserta didik mampu menyebutkan..."
           - "[C2 - Memahami] Peserta didik mampu menjelaskan..."
           - "[C3 - Menerapkan] Peserta didik mampu menggunakan..."
           - "[C4 - Menganalisis] Peserta didik mampu menganalisis..."
           - "[C5 - Mengevaluasi] Peserta didik mampu mengevaluasi..."
           - "[C6 - Menciptakan] Peserta didik mampu merancang..."
         
         ATURAN MUTLAK INDIKATOR & KKTP: Harus berupa pernyataan operasional yang terukur (pernyataan deklaratif, diawali dengan 'Peserta didik mampu...' atau 'Siswa dapat...'). DILARANG KERAS MENGGUNAKAN KALIMAT TANYA ATAU INSTRUMEN SOAL.
         
         Pastikan setiap butir ditulis sangat detail, bervariasi, dan menggunakan Kata Kerja Operasional (KKO) yang tepat. JANGAN disingkat.
         
         
      8. Assessment: Sebutkan jenis asesmen (Formatif/Sumatif) yang variatif.
      9. Sumber Belajar & Dimensi Profil Lulusan: Berikan sumber belajar dan Dimensi Profil Lulusan yang relevan.
      10. PENYELARASAN DENGAN PEMBELAJARAN MENDALAM (DEEP LEARNING) 8-3-3-4:
          - Anda WAJIB menyelaraskan rancangan Alur Tujuan Pembelajaran (ATP) ini dengan konsep "Pembelajaran Mendalam (Deep Learning) 8-3-3-4".
          - 8 Profil Lulusan: Di dalam field "p3" (Dimensi Profil Lulusan), Anda WAJIB memilih 2-3 dimensi yang paling relevan dengan topik dari 8 Dimensi Profil Lulusan baru (Deep Learning 8-3-3-4) berikut: (1) Keimanan & Ketakwaan, (2) Kewargaan, (3) Penalaran Kritis, (4) Kreativitas, (5) Kolaborasi, (6) Kemandirian, (7) Kesehatan, (8) Komunikasi. DILARANG KERAS menggunakan istilah atau item Profil Pelajar Pancasila (P3) lama (seperti Beriman bertakwa..., Bergotong royong, Berkebinekaan global, dll). Gunakan hanya 8 dimensi lulusan baru tersebut secara eksplisit. Pilih 3-4 profil paling relevan untuk dicantumkan.
          - 3 Prinsip Pembelajaran: Rancang indikator, materi, dan asesmen agar memenuhi aspek Berkesadaran (mindful/fokus), Bermakna (meaningful/kontekstual), dan Menggembirakan (joyful).
          - 3 Pengalaman Belajar: Rancang alur kegiatan dan materi agar siswa diarahkan untuk (1) Memahami konsep secara utuh, (2) Mengaplikasikannya dalam situasi nyata, dan (3) Merefleksikan pengalaman belajar tersebut untuk menemukan makna baru.
          - 4 Kerangka Pembelajaran: Tentukan rekomendasi kegiatan dan sumber belajar (field "resources") yang mendukung Praktik Pedagogik berpusat pada siswa, Lingkungan Belajar yang aman dan kondusif, Pemanfaatan Media Digital secara inovatif, serta Kemitraan dengan orang tua/masyarakat.
      
      Output HARUS JSON murni mengikuti skema.
    `;

    const requestBody = JSON.stringify({ prompt, schema: ATP_SCHEMA });
    console.log(`[OpenAIService] Request size (Class ${classLevel}): ${(requestBody.length / 1024).toFixed(2)} KB`);
    
    const response = await robustFetch("/api/openai/generate-atp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }).catch(err => {
      console.error(`Fetch ATP error details for class ${classLevel}:`, err);
      throw new Error(`Koneksi terputus: ${err.message || "Gagal menghubungkan ke server."}`);
    });

    if (!response.ok) {
      let errorMsg = `Gagal menyusun ATP Kelas ${classLevel}.`;
      try {
        const errorData = await parseResponseJson(response);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        errorMsg = `Server error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMsg);
    }

    const { text } = await parseResponseJson(response);
    if (!text) throw new Error(`AI tidak memberikan respon (kosong) untuk Kelas ${classLevel}.`);
    return safeParseJson(text);
  };

  try {
    const results = [];
    for (const cls of classLevels) {
      const res = await generateForClass(cls);
      
      // Auto-correct / Distribusi paksa bila total pertemuan di bawah 24
      if (res.items && res.items.length > 0) {
        let sortedItems = res.items.map((item: any) => ({
          ...item,
          classLevel: String(cls) // Force match with the class it was generated for!
        })).sort((a: any, b: any) => (a.flow || 0) - (b.flow || 0));
        
        // Hitung ketersediaan TP di masing-masing semester
        const hasSem1 = sortedItems.some(item => Number(item.semester) === 1);
        const hasSem2 = sortedItems.some(item => Number(item.semester) === 2);
        
        // Jika ada minimal 2 TP namun salah satu semester kosong, distribusikan secara seimbang
        if (sortedItems.length >= 2 && (!hasSem1 || !hasSem2)) {
          const midPoint = Math.ceil(sortedItems.length / 2);
          sortedItems = sortedItems.map((item, idx) => {
            return {
              ...item,
              semester: idx < midPoint ? 1 : 2
            };
          });
        } else {
          // Pastikan semua item memiliki field semester yang valid (1 atau 2)
          sortedItems = sortedItems.map((item) => {
            const sem = Number(item.semester);
            return {
              ...item,
              semester: (sem === 1 || sem === 2) ? sem : 1
            };
          });
        }

        let totalMeetings = sortedItems.reduce((sum: number, item: any) => sum + (item.numberOfMeetings || 0), 0);
        while (totalMeetings < 24) {
          // Tambahkan 1 pertemuan ke item secara round-robin sampai mencapai 24
          for (const item of sortedItems) {
            item.numberOfMeetings = (item.numberOfMeetings || 1) + 1;
            item.jp = item.numberOfMeetings * jpPerWeek;
            totalMeetings++;
            if (totalMeetings >= 24) break;
          }
        }

        // Hitung ulang startWeek dan endWeek secara dinamis agar jadwal semester rapi dan konsisten
        const sem1Items = sortedItems.filter((item: any) => Number(item.semester) === 1);
        const sem2Items = sortedItems.filter((item: any) => Number(item.semester) === 2);

        let currentSem1Week = 1;
        sem1Items.forEach((item: any) => {
          const weeksNeeded = item.numberOfMeetings || 1;
          item.startWeek = currentSem1Week;
          item.endWeek = currentSem1Week + weeksNeeded - 1;
          currentSem1Week = item.endWeek + 1;
        });

        let currentSem2Week = 1;
        sem2Items.forEach((item: any) => {
          const weeksNeeded = item.numberOfMeetings || 1;
          item.startWeek = currentSem2Week;
          item.endWeek = currentSem2Week + weeksNeeded - 1;
          currentSem2Week = item.endWeek + 1;
        });

        res.items = sortedItems;
      }

      results.push(res);
    }
    
    const combinedItems = results.flatMap(r => r.items || []);
    const combinedRationale = results.map((r, i) => `**Kelas ${classLevels[i]}**\n${r.rationale || ''}`).join('\n\n');

    return {
      phase: mapping.phase,
      classes: mapping.classes,
      items: combinedItems,
      rationale: combinedRationale
    };
  } catch (error: any) {
    console.error("OpenAI ATP Error:", error);
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('limit')) {
      throw new Error(error.message);
    }
    throw new Error(error.message || "Gagal menyusun ATP. Silakan coba lagi.");
  }
}

const INFOGRAPHIC_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    topicTitle: { type: Type.STRING },
    jenjang: { type: Type.STRING },
    isIpsSubject: { type: Type.BOOLEAN, description: "Apakah materi ini terkait Ilmu Pengetahuan Sosial (IPS)" },
    ipsDomain: { type: Type.STRING, description: "Domain IPS jika relevan: Geografi, Ekonomi, Sosiologi, Sejarah, atau Umum" },
    intro: { type: Type.STRING, description: "Pengantar singkat 2-3 kalimat menarik" },
    coreConcept: { type: Type.STRING, description: "Penjelasan konsep utama dengan bahasa sederhana" },
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          subheading: { type: Type.STRING },
          explanation: { type: Type.STRING },
          keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
          simpleExample: { type: Type.STRING },
          imagePrompt: { type: Type.STRING, description: "English prompt for image generation / unsplash keyword" },
          visualType: { type: Type.STRING, description: "map, diagram, chart, illustration, timeline, or comparison" },
          simplifiedExplanation: { type: Type.STRING, description: "Penjelasan yang jauh lebih sederhana" },
          simplifiedAnalogy: { type: Type.STRING, description: "Analogi nyata dalam kehidupan sehari-hari siswa" },
          extraDetails: { type: Type.STRING, description: "Penjelasan mendalam saat diklik" }
        },
        required: ["id", "subheading", "explanation", "keyPoints", "simpleExample", "imagePrompt", "visualType", "simplifiedExplanation", "simplifiedAnalogy", "extraDetails"]
      }
    },
    realLifeExamples: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3-4 contoh penerapan sehari-hari" },
    funFact: { type: Type.STRING, description: "1 fakta menarik Tahukah Kamu?" },
    conclusions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3-5 poin ringkasan utama" },
    understandingQuestions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "3 pertanyaan refleksi pemahaman" },
    quiz: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          correctIndex: { type: Type.INTEGER },
          explanation: { type: Type.STRING }
        },
        required: ["question", "options", "correctIndex", "explanation"]
      },
      description: "2-3 kuis interaktif pilihan ganda"
    },
    thinkQuestions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "2 pertanyaan Coba Pikirkan" }
  },
  required: [
    "topicTitle", "jenjang", "isIpsSubject", "ipsDomain", "intro", "coreConcept",
    "sections", "realLifeExamples", "funFact", "conclusions", "understandingQuestions",
    "quiz", "thinkQuestions"
  ]
};

export async function generateInfographic(
  topicTitle: string,
  jenjang: 'SD' | 'SMP' | 'SMA/SMK' = 'SMP',
  contextDetails?: {
    tpStatement?: string;
    kktpItems?: string[];
    meaningfulUnderstanding?: string;
  }
): Promise<InfographicData> {
  const tpContextStr = contextDetails?.tpStatement 
    ? `\n    - TUJUAN PEMBELAJARAN (TP): ${contextDetails.tpStatement}` 
    : '';
  const kktpContextStr = (contextDetails?.kktpItems && contextDetails.kktpItems.length > 0)
    ? `\n    - KRITERIA KETERCAPAIAN TUJUAN PEMBELAJARAN (KKTP / INDIKATOR):\n      ${contextDetails.kktpItems.map((k, i) => `${i + 1}. ${k}`).join('\n      ')}`
    : '';
  const meaningfulContextStr = contextDetails?.meaningfulUnderstanding
    ? `\n    - PEMAHAMAN BERMAKNA: ${contextDetails.meaningfulUnderstanding}`
    : '';

  const prompt = `
    Anda adalah Pakar Desain Media Pembelajaran Edukatif dan Kurikulum Merdeka Indonesia.
    Tugas: Buatlah INFOGRAFIS PEMBELAJARAN LENGKAP, MENARIK, VISUAL, dan INTERAKTIF untuk materi:
    JUDAUL MATERI: "${topicTitle}"
    JENJANG PENDIDIKAN: ${jenjang}${tpContextStr}${kktpContextStr}${meaningfulContextStr}
    
    PETUNJUK UTAMA & MANDAT KETAT KURIKULUM MERDEKA:
    1. SINKRONISASI TP & KKTP: Materi, uraian subtopik (sections), contoh, dan kuis dalam infografis WAKTU DAN WAJIB SECARA LANGSUNG MENJAWAB DAN MEMENUHI Tujuan Pembelajaran (TP) serta Kriteria Ketercapaian Tujuan Pembelajaran (KKTP) yang disebutkan di atas.
    2. Bahasa: Gunakan bahasa Indonesia yang ramah, komunikatif, dan disesuaikan dengan tingkat perkembangan siswa ${jenjang}.
    3. Jika judul materi berkaitan dengan IPS (Geografi, Ekonomi, Sosiologi, Sejarah), atur isIpsSubject=true dan tentukan ipsDomain yang sesuai (Geografi, Ekonomi, Sosiologi, Sejarah, atau Umum).
    4. Struktur Bagian (sections): Bagi materi menjadi 3 hingga 5 subtopik/bagian utama secara logis yang secara bertahap menuntaskan seluruh KKTP.
       - Setiap bagian wajib memiliki:
         - Subjudul
         - Penjelasan singkat & padat (menjawab TP/KKTP)
         - 2-4 Poin-poin penting
         - Contoh sederhana
         - imagePrompt: Kata kunci visual atau deskripsi gambar singkat dalam bahasa Inggris yang SANGAT SPESIFIK dan AKURAT sesuai dengan penjelasan materi tersebut (misal: "detailed map of indonesian archipelago trading routes between islands ships maritim" atau "market sellers exchanging goods spices clothes indonesia").
         - visualType: pilih salah satu dari ('map', 'diagram', 'chart', 'illustration', 'timeline', 'comparison')
         - simplifiedExplanation: Penjelasan ulang yang SANGAT SEDERHANA
         - simplifiedAnalogy: Analogi konkret kehidupan sehari-hari (misal: 'Bayangkan kamu membawa uang Rp20.000 untuk...')
         - extraDetails: Informasi tambahan ketika siswa mengklik 'Klik untuk mengetahui lebih lanjut'.
    5. Contoh Kehidupan Sehari-hari (realLifeExamples): Berikan 3-4 contoh konkret.
    6. Tahukah Kamu? (funFact): Berikan 1 fakta unik & menarik.
    7. Kesimpulan (conclusions): 3-5 poin ringkasan utama yang menegaskan ketercapaian TP.
    8. Pertanyaan Pemahaman (understandingQuestions): 3 pertanyaan evaluasi singkat sesuai KKTP.
    9. Kuis Interaktif (quiz): 2-3 soal pilihan ganda (4 opsi, index jawaban benar 0-3, serta pembahasan ringkas) yang menguji Ketercapaian TP & KKTP.
    10. Coba Pikirkan (thinkQuestions): 2 pertanyaan pemantik diskusi.

    Output HARUS berupa JSON murni sesuai skema.
  `;

  const requestBody = JSON.stringify({ prompt, schema: INFOGRAPHIC_SCHEMA });

  const response = await robustFetch("/api/openai/generate-simple", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody,
  }).catch(err => {
    throw new Error(`Gagal menghubungkan ke layanan AI: ${err.message}`);
  });

  if (!response.ok) {
    let errorMsg = "Gagal membuat infografis pembelajaran.";
    try {
      const errorData = await parseResponseJson(response);
      errorMsg = errorData.error || errorMsg;
    } catch (e) {
      errorMsg = `Server error (${response.status}): ${response.statusText}`;
    }
    throw new Error(errorMsg);
  }

  const { text } = await parseResponseJson(response);
  if (!text) throw new Error("AI tidak memberikan balasan.");

  const parsed = safeParseJson(text) as InfographicData;
  parsed.topicTitle = parsed.topicTitle || topicTitle;
  parsed.jenjang = parsed.jenjang || jenjang;

  // Process sections to attach generated visual assets matching the exact section explanation
  if (Array.isArray(parsed.sections)) {
    parsed.sections = parsed.sections.map((sec, idx) => {
      const promptQuery = (sec.imagePrompt || sec.subheading || topicTitle)
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .trim();

      // Pollinations AI custom image generator matching the exact prompt
      const pollinationsImg = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptQuery + " educational illustration clear high quality detailed")}`;

      return {
        ...sec,
        id: sec.id || `section-${idx + 1}`,
        imageUrl: sec.imageUrl || pollinationsImg
      };
    });
  }

  return parsed;
}
