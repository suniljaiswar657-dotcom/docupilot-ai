(() => {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "docupilot-ai-documents-v1";
  let documents = loadDocuments();
  let activeView = "all";
  let toastTimer;
  let latestExtractedText = "";

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  function loadDocuments() {
    try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(saved) ? saved : []; }
    catch { return []; }
  }
  function saveDocuments() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(documents)); }
    catch { showToast("Browser storage is full. New document details may not persist."); }
  }
  function showToast(message) {
    const toast = $("toast"); toast.textContent = message; toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }
  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {month:"short",day:"numeric",year:"numeric"}).format(new Date(value));
  }
  function categoryFor(name) {
    const n = name.toLowerCase();
    if (/invoice|bill|tax-invoice/.test(n)) return "invoices";
    if (/receipt|payment|transaction/.test(n)) return "receipts";
    return "other";
  }
  function categoryLabel(c) { return c === "invoices" ? "Invoice" : c === "receipts" ? "Receipt" : "Other"; }
  function fileKind(name) {
    const ext = name.split(".").pop().toLowerCase();
    if (ext === "pdf") return {label:"PDF",icon:"▤",cls:"pdf"};
    if (["png","jpg","jpeg","webp"].includes(ext)) return {label:"Image",icon:"▧",cls:"image"};
    return {label:ext.toUpperCase() || "File",icon:"▱",cls:""};
  }
  function updateStats() {
    $("total-stat").textContent = documents.length;
    $("invoice-stat").textContent = documents.filter(d=>d.category==="invoices").length;
    $("receipt-stat").textContent = documents.filter(d=>d.category==="receipts").length;
    $("other-stat").textContent = documents.filter(d=>d.category==="other").length;
    $("storage-count").textContent = documents.length + (documents.length===1?" document added":" documents added");
  }
  function render() {
    updateStats();
    const query=$("search-input").value.trim().toLowerCase(), category=$("category-filter").value, sort=$("sort-filter").value;
    let filtered=documents.filter(d=>d.name.toLowerCase().includes(query)&&(category==="all"||d.category===category)&&(activeView==="all"||d.category===activeView));
    filtered.sort((a,b)=>sort==="name"?a.name.localeCompare(b.name):sort==="oldest"?new Date(a.addedAt)-new Date(b.addedAt):new Date(b.addedAt)-new Date(a.addedAt));
    const list=$("document-list"); list.innerHTML="";
    if(!filtered.length){
      const empty=document.createElement("div"); empty.className="empty-state";
      empty.innerHTML='<div class="empty-art"><span>⌕</span><i>✦</i></div><h3>'+ (documents.length?"No matching documents":"Your workspace is ready") +'</h3><p>'+ (documents.length?"Try another search term or category filter.":"Upload a PDF or image to extract and organize its text.") +'</p>'+ (documents.length?'<button class="text-button" id="reset-empty">Reset search and filters</button>':'<button class="primary-button small" id="empty-upload">＋ Add your first document</button><small>PDF, PNG, JPG and WEBP</small>');
      list.appendChild(empty);
      if($("reset-empty")) $("reset-empty").addEventListener("click",resetFilters);
      if($("empty-upload")) $("empty-upload").addEventListener("click",openPicker);
      return;
    }
    filtered.forEach(doc=>{
      const kind=fileKind(doc.name),row=document.createElement("div"); row.className="document-row";
      const name=document.createElement("div"); name.className="file-name";
      const icon=document.createElement("span"); icon.className="file-icon "+kind.cls; icon.textContent=kind.icon;
      const details=document.createElement("span"),title=document.createElement("b"),sub=document.createElement("small");
      title.textContent=doc.name; sub.textContent=kind.label+(doc.extractedText?" · Text extracted":" · Added"); details.append(title,sub); name.append(icon,details);
      const cat=document.createElement("span"); cat.className="category-cell";
      const pill=document.createElement("span"); pill.className="category-pill "+doc.category; pill.textContent=categoryLabel(doc.category); cat.appendChild(pill);
      const size=document.createElement("span"); size.className="size-cell row-muted"; size.textContent=formatSize(doc.size);
      const date=document.createElement("span"); date.className="date-cell row-muted"; date.textContent=formatDate(doc.addedAt);
      const view=document.createElement("button"); view.className="row-menu"; view.type="button"; view.textContent="↗"; view.title="View extracted text"; view.setAttribute("aria-label","View "+doc.name);
      view.addEventListener("click",()=>showSavedText(doc));
      row.append(name,cat,size,date,view); list.appendChild(row);
    });
  }

  function parseInvoiceText(raw) {
    const text=String(raw||"").replace(/\u00a0/g," ").replace(/[₹]/g," INR ");
    const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const findLine=(regex)=>lines.find(line=>regex.test(line))||"";
    const afterLabel=(regex)=>{
      const line=findLine(regex);
      if(!line)return "";
      const match=line.match(/(?:invoice\s*(?:no|number|#)|bill\s*(?:no|number|#)|dated|invoice\s*date|due\s*date|gstin|taxable\s*value|sub\s*total|subtotal|grand\s*total|total\s*(?:amount|due)|amount\s*payable|cgst|sgst|igst)[\s:#-]*([A-Z0-9][A-Z0-9\/-]{1,30})/i);
      return match?match[1]:"";
    };
    const invoiceNo=afterLabel(/invoice\s*(?:no|number|#)|bill\s*(?:no|number|#)/i);
    const gstin=(text.match(/\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/i)||[])[0]||"";
    const datePattern=/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i;
    const pickDate=(regex)=>{const line=findLine(regex);const m=line.match(datePattern);return m?m[1]:"";};
    const invoiceDate=pickDate(/invoice\s*date|\bdated\b|date\s*:/i);
    const dueDate=pickDate(/due\s*date|payment\s*due|pay\s*by/i);
    const moneyFrom=(regex)=>{
      const line=findLine(regex);
      if(!line)return "";
      const matches=line.match(/(?:INR\s*)?\d[\d,]*(?:\.\d{1,2})?/gi);
      if(!matches||!matches.length)return "";
      const candidate=matches[matches.length-1].replace(/INR\s*/i,"").replace(/,/g,"");
      const value=Number(candidate);
      return Number.isFinite(value)?value.toFixed(2):"";
    };
    let gstAmount="";
    const directGst=moneyFrom(/\btotal\s*gst\b|\bgst\s*amount\b|\btotal\s*tax\b/i);
    if(directGst) gstAmount=directGst;
    else {
      const parts=["cgst","sgst","igst"].map(key=>moneyFrom(new RegExp("\\b"+key+"\\b","i"))).filter(Boolean).map(Number);
      if(parts.length)gstAmount=parts.reduce((a,b)=>a+b,0).toFixed(2);
    }
    const subtotal=moneyFrom(/taxable\s*value|sub\s*total|subtotal|before\s*tax/i);
    const total=moneyFrom(/grand\s*total|total\s*amount|amount\s*payable|net\s*payable|balance\s*due/i);
    let vendor="";
    for(const line of lines.slice(0,12)){
      if(line.length<3||line.length>70)continue;
      if(/^(page\s*\d+|tax invoice|invoice|receipt|bill of supply|original for recipient)/i.test(line))continue;
      if(/invoice\s*(no|number|date)|gstin|phone|email|www\.|http/i.test(line))continue;
      if(datePattern.test(line))continue;
      vendor=line;break;
    }
    return {
      vendor:vendor,invoiceNumber:invoiceNo,invoiceDate:invoiceDate,dueDate:dueDate,
      gstin:gstin,subtotal:subtotal,gstAmount:gstAmount,total:total
    };
  }
  function renderInsights(data) {
    const grid=$("insights-grid");
    const fields=[
      ["Vendor / business",data.vendor],["Invoice number",data.invoiceNumber],
      ["Invoice date",data.invoiceDate],["Due date",data.dueDate],
      ["GSTIN",data.gstin],["Taxable value",data.subtotal? "₹"+data.subtotal:""],
      ["GST amount",data.gstAmount? "₹"+data.gstAmount:""],["Total amount",data.total? "₹"+data.total:""]
    ];
    grid.innerHTML="";
    let found=0;
    fields.forEach(([label,value])=>{
      const cell=document.createElement("div");cell.className="insight-cell";
      const key=document.createElement("span");key.textContent=label;
      const val=document.createElement("strong");val.textContent=value||"Not detected";
      if(value)found++;
      if(!value)val.classList.add("not-detected");
      cell.append(key,val);grid.appendChild(cell);
    });
    $("insights-status").textContent=found+" of 8 fields detected. Please verify the values.";
  }
  function setExtractionState(title,status,text,progress=null,meta="PDF text extraction · Image OCR") {
    $("extract-title").textContent=title; $("extract-status").textContent=status; $("extracted-text").textContent=text;
    $("extract-meta").textContent=meta; $("extract-progress-wrap").hidden=progress===null;
    if(progress!==null) $("extract-progress").style.width=Math.max(0,Math.min(100,progress))+"%";
    $("copy-extracted").disabled=!text || text.startsWith("Your extracted") || text.startsWith("No selectable");
    latestExtractedText=$("copy-extracted").disabled?"":text;
  }
  function showSavedText(doc) {
    $("extract-panel").scrollIntoView({behavior:"smooth",block:"center"});
    setExtractionState(doc.name,doc.extractedText?"Previously extracted text":"No extracted text saved for this document.",doc.extractedText||"No selectable text is available. Upload this file again to run extraction.",null,doc.extractedText?"Saved in this browser":"No text available");
    renderInsights(doc.parsedData||parseInvoiceText(doc.extractedText||""));
  }
  async function extractPdf(file) {
    if(!window.pdfjsLib) throw new Error("PDF reader library did not load. Check your internet connection and refresh.");
    const data=new Uint8Array(await file.arrayBuffer());
    const pdf=await pdfjsLib.getDocument({data}).promise;
    const pageLimit=Math.min(pdf.numPages,30),chunks=[];
    for(let pageNo=1;pageNo<=pageLimit;pageNo++){
      $("extract-status").textContent="Reading PDF page "+pageNo+" of "+pageLimit+"…";
      $("extract-progress").style.width=Math.round(pageNo/pageLimit*100)+"%";
      const page=await pdf.getPage(pageNo),content=await page.getTextContent();
      const line=content.items.map(item=>item.str).filter(Boolean).join(" ");
      if(line.trim()) chunks.push("PAGE "+pageNo+"\n"+line);
    }
    let text=chunks.join("\n\n").trim();
    if(pdf.numPages>pageLimit) text+="\n\n[Only the first "+pageLimit+" pages were processed in this version.]";
    return {text,pages:pdf.numPages,scanned:!text};
  }
  async function extractImage(file) {
    if(!window.Tesseract) throw new Error("OCR library did not load. Check your internet connection and refresh.");
    const result=await Tesseract.recognize(file,"eng",{
      logger:message=>{
        if(message.status==="recognizing text"){
          const pct=Math.round((message.progress||0)*100);
          $("extract-status").textContent="OCR is reading the image… "+pct+"%";
          $("extract-progress").style.width=pct+"%";
        } else if(message.status) $("extract-status").textContent="Preparing OCR: "+message.status+"…";
      }
    });
    return {text:(result.data.text||"").trim(),pages:1};
  }
  async function processFile(file) {
    const isPdf=file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf");
    const isImage=/^image\/(png|jpeg|webp)$/.test(file.type)||/\.(png|jpe?g|webp)$/i.test(file.name);
    if(!isPdf&&!isImage){showToast("This version supports PDF, PNG, JPG and WEBP files.");return;}
    const key=file.name+"|"+file.size;
    const existing=documents.find(d=>d.name+"|"+d.size===key);
    $("extract-panel").scrollIntoView({behavior:"smooth",block:"center"});
    setExtractionState(file.name,"Preparing your document…","Extraction is starting.",0,isPdf?"PDF · Text layer":"Image · English OCR");
    try {
      const result=isPdf?await extractPdf(file):await extractImage(file);
      let text=result.text;
      if(!text){
        const message=isPdf?"No selectable text found. This may be a scanned PDF; scanned-PDF OCR is not included yet.":"No readable text found in this image. Try a clearer, well-lit image.";
        setExtractionState(file.name,"Extraction finished, but no text was detected.",message,null,"No text detected");
        renderInsights({});
        text="";
      } else {
        const savedText=text.slice(0,5000);
        const parsedData=parseInvoiceText(text);
        if(existing){existing.extractedText=savedText;existing.parsedData=parsedData;existing.extractedAt=new Date().toISOString();}
        else documents.unshift({id:(crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(16).slice(2)),name:file.name,size:file.size,type:file.type||"application/octet-stream",category:categoryFor(file.name),addedAt:new Date().toISOString(),extractedText:savedText,parsedData:parsedData});
        saveDocuments(); render();
        const note=text.length>5000?"\n\n[Preview limited to first 5,000 characters in browser storage.]":"";
        setExtractionState(file.name,"Text extraction complete.",text.slice(0,5000)+note,100,isPdf?"PDF · "+result.pages+" page(s) checked":"Image · English OCR");
        renderInsights(parsedData);
        showToast("Text extracted successfully.");
      }
    } catch(error) {
      console.error("DOCUPILOT extraction error:",error);
      setExtractionState(file.name,"Could not extract text.",error.message||"Unexpected extraction error.",null,"Extraction failed");
      showToast("Extraction failed. Check the file and internet connection.");
    }
  }
  function openPicker(){ $("file-input").click(); }
  function resetFilters(){
    $("search-input").value=""; $("category-filter").value="all"; $("sort-filter").value="newest"; activeView="all";
    document.querySelectorAll(".nav-item").forEach(item=>item.classList.toggle("active",item.textContent.includes("Overview")));
    $("page-label").textContent="Overview"; render();
  }
  $("upload-trigger").addEventListener("click",openPicker);
  $("empty-upload").addEventListener("click",openPicker);
  $("file-input").addEventListener("change",async event=>{
    const files=Array.from(event.target.files||[]);
    if(!files.length)return;
    for(const file of files) await processFile(file);
    event.target.value="";
  });
  $("copy-extracted").addEventListener("click",async()=>{
    if(!latestExtractedText)return;
    try{await navigator.clipboard.writeText(latestExtractedText);showToast("Extracted text copied.");}
    catch{showToast("Clipboard access unavailable in this browser.");}
  });
  $("search-input").addEventListener("input",render);
  $("category-filter").addEventListener("change",render);
  $("sort-filter").addEventListener("change",render);
  $("clear-search").addEventListener("click",resetFilters);
  document.querySelectorAll(".nav-item").forEach(item=>item.addEventListener("click",()=>{
    activeView=item.dataset.view; $("page-label").textContent=item.textContent.trim();
    document.querySelectorAll(".nav-item").forEach(nav=>nav.classList.toggle("active",nav===item));
    $("category-filter").value="all"; render(); $("sidebar").classList.remove("open");
  }));
  $("mobile-menu").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
  render();
})();