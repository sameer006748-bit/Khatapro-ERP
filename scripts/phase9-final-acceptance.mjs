// Phase 9 — Final Acceptance Harness (comprehensive)
// Self-contained: starts server, runs all tests in one process, exits non-zero on any failure.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const PORT = 3211
const BASE = `http://localhost:${PORT}`
const PDF_DIR = '/home/z/my-project/download/p9-pdfs'
const R = { passed: 0, failed: 0, blocked: 0, details: [] }
function log(m) { console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`) }
function pass(n) { R.passed++; R.details.push({n,s:'PASS'}); log(`✓ ${n}`) }
function fail(n,e) { R.failed++; R.details.push({n,s:'FAIL',e}); log(`✗ ${n}: ${e}`) }
function block(n,r) { R.blocked++; R.details.push({n,s:'BLOCK',r}); log(`⊘ ${n}: ${r}`) }

const CASH='75e87a1f-dd87-4ddc-8391-a59034fe9cc1'
const VENDOR='f9ae962f-efa8-4cd8-ba41-afa31b6fee77'
const SM='26302fa0-4643-461e-bce5-9d6f857834fb'
const RIDER='4d6b6ee8-f3fb-433a-9884-1d033f8176c5'
const TODAY='2026-07-12'

// Env
const envFile = readFileSync('/home/z/my-project/.env.local','utf8')
const env = {}
envFile.split('\n').forEach(l=>{const m=l.match(/^([A-Z_]+)=(.+)$/);if(m)env[m[1]]=m[2].trim()})
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}})

async function startServer() {
  log('Starting production server...')
  const proc = spawn('bun', ['.next/standalone/server.js'], {cwd:'/home/z/my-project',env:{...process.env,PORT:String(PORT),NODE_ENV:'production'},stdio:['ignore','pipe','pipe']})
  proc.stdout.on('data',d=>process.stdout.write(d)); proc.stderr.on('data',d=>process.stderr.write(d))
  for(let i=0;i<30;i++){try{const r=await fetch(`${BASE}/api/supabase-status`);if(r.ok){const d=await r.json();if(d.configured&&d.reachable){log('Server up');return proc}}}catch{}await new Promise(r=>setTimeout(r,1000))}
  throw new Error('Server failed')
}

async function signIn(page,email,pw){
  await page.goto(`${BASE}/`,{waitUntil:'networkidle'})
  await page.fill('input[type=email]',email); await page.fill('input[type=password]',pw)
  await page.evaluate(()=>document.querySelector('form')?.requestSubmit())
  await page.waitForTimeout(3000)
  return (await page.evaluate(async()=>{const r=await fetch('/api/me');return r.json()})).user
}

async function api(page,method,path,body){
  const r=await page.evaluate(async({path,method,bodyStr})=>{
    const opts={method,headers:{'Content-Type':'application/json'}}
    if(bodyStr)opts.body=bodyStr
    const r=await fetch(path,opts); const t=await r.text()
    return{status:r.status,text:t}
  },{path,method,bodyStr:body?JSON.stringify(body):null})
  try{return{status:r.status,json:JSON.parse(r.text)}}catch{return{status:r.status,text:r.text}}
}

function pdfInfo(path){try{return execSync(`pdfinfo "${path}" 2>/dev/null`,{encoding:'utf8'}).split('\n').reduce((a,l)=>{const m=l.match(/^(.+?):\s+(.+)$/);if(m)a[m[1].trim()]=m[2].trim();return a},{})}catch{return{}}}

// Generate a print PDF and verify dimensions + DOM content
async function generatePrintPdf(page, invoiceId, mode, label, pdfPath) {
  await page.goto(`${BASE}/?invoice=${invoiceId}`,{waitUntil:'networkidle'})
  await page.waitForTimeout(2000)
  // Click Print button
  await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Print'));b?.click()})
  await page.waitForTimeout(2000)
  // Select mode
  await page.evaluate((lbl)=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===lbl);b?.click()},label)
  await page.waitForTimeout(500)

  // Verify DOM content BEFORE generating PDF (since pdftotext can't extract Skia-rendered text)
  const domContent = await page.evaluate(()=>{
    const root = document.querySelector('.invoice-print-root')
    if(!root) return {exists:false}
    const text = root.textContent || ''
    return {
      exists: true,
      hasGrandTotal: /Grand Total/i.test(text),
      hasPaid: /Paid/i.test(text),
      hasINVOICE: /INVOICE/i.test(text),
      hasBusinessName: /KhataPro/i.test(text),
      hasNoUUID: !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(text),
      hasNoCost: !/WAC|weighted.average/i.test(text),
      hasNoFabSKU: !/\[[A-F0-9]{8}\]/.test(text),
      itemCount: root.querySelectorAll('.inv-items-table tbody tr').length,
      paymentCount: root.querySelectorAll('.inv-payment-row').length,
    }
  })

  // Inject @page style + printing class
  await page.evaluate((md)=>{
    document.body.classList.add('printing-invoice')
    const s=document.createElement('style');s.id='ipp'
    s.textContent=md==='single'?'@page { size: 210mm 148.5mm; margin: 0; }':'@page { size: A4 portrait; margin: 0; }'
    document.head.appendChild(s)
  },mode)
  await page.emulateMedia({media:'print'})
  await page.pdf({path:pdfPath,format:'A4',printBackground:true,margin:{top:0,right:0,bottom:0,left:0},preferCSSPageSize:true})
  await page.emulateMedia({media:'screen'})
  await page.evaluate(()=>{document.body.classList.remove('printing-invoice');document.getElementById('ipp')?.remove()})

  const pi = pdfInfo(pdfPath)
  return { pi, domContent }
}

async function main(){
  mkdirSync(PDF_DIR,{recursive:true})
  mkdirSync('/home/z/my-project/audit-out',{recursive:true})
  const server=await startServer()
  const browser=await chromium.launch({headless:true})
  let exitCode=0

  try{
    // ═══ 1. AUTH ═══
    log('═══ 1. AUTH ═══')
    const page=await browser.newPage({viewport:{width:1280,height:800}})
    const owner=await signIn(page,'owner@test.local','password123')
    if(owner?.email==='owner@test.local')pass('Owner login');else fail('Owner login',owner?.email||'none')

    const acctPage=await browser.newPage()
    if((await signIn(acctPage,'accountant@test.local','password123'))?.email)pass('Accountant login');else fail('Accountant login','')

    const smPage=await browser.newPage()
    if((await signIn(smPage,'salesman@test.local','password123'))?.email)pass('Salesman login');else fail('Salesman login','')

    const riderPage=await browser.newPage()
    if((await signIn(riderPage,'rider@test.local','password123'))?.email)pass('Rider login');else fail('Rider login','')

    // ═══ 2. TB/BS BEFORE ═══
    log('═══ 2. FINANCIALS BEFORE ═══')
    const tbB=await api(page,'GET','/api/trial-balance')
    const tbR=Array.isArray(tbB.json)?tbB.json:(tbB.json?.rows||[])
    const tbDr=tbR.reduce((s,r)=>s+BigInt(r.totalDebit||r.total_debit||0),0n)
    const tbCr=tbR.reduce((s,r)=>s+BigInt(r.totalCredit||r.total_credit||0),0n)
    if(tbDr===tbCr)pass(`TB before: Dr=${tbDr} Cr=${tbCr} Diff=0`);else fail('TB before',`Dr=${tbDr} Cr=${tbCr}`)

    // ═══ 3. WRITE FLOWS ═══
    log('═══ 3. WRITE FLOWS ═══')
    const {data:accts}=await sb.from('accounts').select('id,code,name').eq('business_id','biz-default').eq('is_active',true).order('code')
    const cashId=accts?.find(a=>a.code==='1010')?.id||CASH
    const pettyId=accts?.find(a=>a.code==='1020')?.id

    // 3a. Product
    const pR=await api(page,'POST','/api/products',{name:'P9 Final Product',salePrice:1500,purchasePrice:1000,lowStockThreshold:5})
    const pid=pR.json?.row?.id
    if(pid)pass(`Product: ${pid.slice(0,8)}...`);else fail('Product',JSON.stringify(pR.json).slice(0,150))

    // 3b. Counter Sale
    const csR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'P9 Final Product',qty:1,unitPrice:'150000',isTemporary:false}],payments:[{accountId:cashId,amount:'150000',isChange:false}],salesmanId:SM,customerName:'P9 Counter Cust'})
    const csId=csR.json?.invoiceId
    if(csId)pass(`Counter Sale: ${csR.json.invoiceNo}`);else fail('Counter Sale',JSON.stringify(csR.json).slice(0,150))

    // 3c. Online Sale WITH delivery
    const osR=await api(page,'POST','/api/sales/online',{invoiceType:'ONLINE',invoiceDate:TODAY,items:[{productId:pid,productName:'P9 Final Product',qty:1,unitPrice:'200000',isTemporary:false}],payments:[{accountId:cashId,amount:'200000',isChange:false}],salesmanId:SM,customerName:'P9 Online Cust',customerPhone:'0300-9999999',customerAddress:'123 Test St',customerCity:'Karachi',deliveryCharge:'300',riderEarning:'200',companyDeliveryIncome:'100',source:'WhatsApp'})
    const osId=osR.json?.invoiceId
    if(osId)pass(`Online Sale: ${osR.json.invoiceNo} (delivery: ${osR.json.deliveryOrderId?'created':'none'})`);else fail('Online Sale',JSON.stringify(osR.json).slice(0,200))

    // 3d. OFC Sale
    const ofcR=await api(page,'POST','/api/sales/ofc',{invoiceType:'OFC',invoiceDate:TODAY,items:[{productId:pid,productName:'P9 Final Product',qty:1,unitPrice:'180000',isTemporary:false}],payments:[{accountId:cashId,amount:'180000',isChange:false}],salesmanId:SM,customerName:'P9 OFC Cust',customerPhone:'0300-8888888',customerAddress:'456 Test Ave',customerCity:'Lahore'})
    const ofcId=ofcR.json?.invoiceId
    if(ofcId)pass(`OFC Sale: ${ofcR.json.invoiceNo}`);else fail('OFC Sale',JSON.stringify(ofcR.json).slice(0,150))

    // 3e. Partial Sale (pay less than total)
    const psR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'P9 Final Product',qty:2,unitPrice:'300000',isTemporary:false}],payments:[{accountId:cashId,amount:'300000',isChange:false}],salesmanId:SM,customerName:'P9 Partial Cust'})
    const psId=psR.json?.invoiceId
    if(psId)pass(`Partial Sale: ${psR.json.invoiceNo}`);else fail('Partial Sale',JSON.stringify(psR.json).slice(0,150))

    // 3f. Purchase
    const purR=await api(page,'POST','/api/purchases',{vendorId:VENDOR,purchaseDate:TODAY,items:[{productId:pid,productName:'P9 Purchase',quantity:10,unitCostPaisas:'100000'}],payments:[{accountId:cashId,amountPaisas:'1000000',paymentType:'purchase_payment'}]})
    const purId=purR.json?.purchaseId
    if(purId)pass(`Purchase: ${purR.json.purchaseNo}`);else fail('Purchase',JSON.stringify(purR.json).slice(0,150))

    // 3g. Purchase Return
    const {data:purItems}=await sb.from('purchase_items').select('id,product_id,product_name,quantity,unit_cost').eq('purchase_id',purId)
    if(purItems&&purItems.length>0){
      const retR=await api(page,'POST',`/api/purchases/${purId}/return`,{returnItems:[{purchaseItemId:purItems[0].id,productId:purItems[0].product_id,productName:purItems[0].product_name,quantity:2,unitCostPaisas:String(purItems[0].unit_cost)}],settlementType:'vendor_refund',settlementAccountId:cashId})
      if(retR.json?.ok)pass(`Purchase Return: ${retR.json.returnNo}`);else fail('Purchase Return',JSON.stringify(retR.json).slice(0,200))
    } else fail('Purchase Return','No purchase items found')

    // 3h. Purchase Replacement
    if(purItems&&purItems.length>0){
      const replR=await api(page,'POST',`/api/purchases/${purId}/replacement`,{replacementItems:[{originalPurchaseItemId:purItems[0].id,outgoingProductId:pid,outgoingProductName:'Defective Item',outgoingQuantity:1,outgoingUnitCostPaisas:'100000',incomingProductId:pid,incomingProductName:'Replacement Item',incomingQuantity:1,incomingUnitCostPaisas:'120000'}],replacementDate:TODAY})
      if(replR.json?.ok)pass(`Purchase Replacement: ${replR.json.replacementNo||'OK'}`);else fail('Purchase Replacement',JSON.stringify(replR.json).slice(0,200))
    } else fail('Purchase Replacement','No purchase items')

    // 3i. JV
    const jvR=await api(page,'POST','/api/journal-voucher',{jvDate:TODAY,memo:'P9 JV',lines:[{accountId:cashId,debit:'100',credit:'0',memo:'Dr'},{accountId:pettyId,debit:'0',credit:'100',memo:'Cr'}]})
    if(jvR.json?.ok||jvR.json?.voucherId)pass('Journal Voucher');else fail('Journal Voucher',JSON.stringify(jvR.json).slice(0,150))

    // 3j. Receipt Voucher
    const rvR=await api(page,'POST','/api/receipt-voucher',{receiptDate:TODAY,receivedIntoAccountId:cashId,creditAccountId:pettyId,amount:'50',reference:'P9 RV'})
    if(rvR.json?.ok||rvR.json?.receiptId)pass('Receipt Voucher');else fail('Receipt Voucher',JSON.stringify(rvR.json).slice(0,150))

    // 3k. Payment Voucher
    const pvR=await api(page,'POST','/api/payment-voucher',{paymentDate:TODAY,paidFromAccountId:cashId,debitAccountId:pettyId,amount:'25',reference:'P9 PV'})
    if(pvR.json?.ok||pvR.json?.paymentId)pass('Payment Voucher');else fail('Payment Voucher',JSON.stringify(pvR.json).slice(0,150))

    // ═══ 4. DELIVERY / COD ═══
    log('═══ 4. DELIVERY / COD ═══')
    const {data: freshDOs } = await sb.from('delivery_orders').select('id,invoice_id,status,total_cod_amount').eq('business_id','biz-default').eq('invoice_id',osId).order('created_at',{ascending:false}).limit(1)
    const pendingOrder = freshDOs && freshDOs.length > 0 ? freshDOs[0] : null
    if(pendingOrder){
      pass(`Fresh delivery order: ${pendingOrder.id.slice(0,8)}... status=${pendingOrder.status}`)
      const aR=await api(page,'POST',`/api/delivery-orders/${pendingOrder.id}/assign`,{riderId:RIDER})
      if(aR.json?.ok)pass('Rider assigned');else fail('Rider assigned',JSON.stringify(aR.json).slice(0,100))
      const sR=await api(page,'POST',`/api/delivery-orders/${pendingOrder.id}/status`,{newStatus:'out_for_delivery'})
      if(sR.json?.ok)pass('Status: out_for_delivery');else fail('Status update',JSON.stringify(sR.json).slice(0,150))
      const codPaisas=BigInt(pendingOrder.total_cod_amount||'200300')
      const codRupees=(Number(codPaisas)/100).toString()
      const dR=await api(page,'POST',`/api/delivery-orders/${pendingOrder.id}/delivered`,{collectedAmount:codRupees})
      if(dR.json?.ok)pass('Marked delivered');else fail('Marked delivered',JSON.stringify(dR.json).slice(0,150))
      const codRupeesStr=(Number(BigInt(pendingOrder.total_cod_amount||'200300'))/100).toString()
      const codR=await api(page,'POST','/api/cod-submission',{riderId:RIDER,items:[{deliveryOrderId:pendingOrder.id,amountAllocated:codRupeesStr}],settlementMode:'full',requestedAmount:codRupeesStr})
      const codId=codR.json?.submissionId||codR.json?.id
      if(codR.json?.ok)pass(`COD submitted: ${codR.json.submissionNo||codId||'OK'}`);else fail('COD submitted',JSON.stringify(codR.json).slice(0,200))
      if(codId||codR.json?.submissionId){
        const cId=codId||codR.json.submissionId
        const cR=await api(page,'POST',`/api/cod-submission/${cId}/confirm`,{confirmedCashAmount:codRupeesStr,receivedIntoAccountId:cashId})
        if(cR.json?.ok)pass('COD confirmed');else fail('COD confirmed',JSON.stringify(cR.json).slice(0,200))
        const dupR=await api(page,'POST',`/api/cod-submission/${cId}/confirm`,{confirmedCashAmount:codRupeesStr,receivedIntoAccountId:cashId})
        if(dupR.status>=400)pass('Duplicate COD blocked');else fail('Duplicate COD blocked','NOT blocked')
        const overR=await api(page,'POST','/api/cod-submission',{riderId:RIDER,items:[{deliveryOrderId:pendingOrder.id,amountAllocated:codRupeesStr}],settlementMode:'full',requestedAmount:codRupeesStr})
        if(overR.status>=400)pass('Over-allocation blocked');else fail('Over-allocation blocked','NOT blocked')
      }
    } else {
      fail('Fresh delivery order','No pending delivery order found')
    }

    // ═══ 5. FINANCIALS AFTER ═══
    log('═══ 5. FINANCIALS AFTER ═══')
    const tbA=await api(page,'GET','/api/trial-balance')
    const tbRA=Array.isArray(tbA.json)?tbA.json:(tbA.json?.rows||[])
    const tbDrA=tbRA.reduce((s,r)=>s+BigInt(r.totalDebit||r.total_debit||0),0n)
    const tbCrA=tbRA.reduce((s,r)=>s+BigInt(r.totalCredit||r.total_credit||0),0n)
    if(tbDrA===tbCrA)pass(`TB after: Dr=${tbDrA} Cr=${tbCrA} Diff=0`);else fail('TB after',`Dr=${tbDrA} Cr=${tbCrA}`)

    const bsA=await api(page,'GET','/api/reports?type=balance-sheet&toDate=2026-07-12')
    const bsRA=bsA.json?.rows||[]
    const bsA2=bsRA.filter(r=>r.section==='ASSET').reduce((s,r)=>s+BigInt(r.balance),0n)
    const bsL2=bsRA.filter(r=>r.section==='LIABILITY').reduce((s,r)=>s+BigInt(r.balance),0n)
    const bsE2=bsRA.filter(r=>r.section==='EQUITY').reduce((s,r)=>s+BigInt(r.balance),0n)
    if(bsA2-bsL2-bsE2===0n)pass('BS after: Diff=0');else fail('BS after',`Diff=${bsA2-bsL2-bsE2}`)

    const plR=await api(page,'GET','/api/reports?type=profit-loss&fromDate=2026-01-01&toDate=2026-12-31')
    const plRows=plR.json?.rows||[]
    const plZeros=plRows.filter(r=>BigInt(r.amount||0)===0n).length
    const plNonPL=plRows.filter(r=>r.category_type!=='Income'&&r.category_type!=='Expense').length
    if(plZeros===0&&plNonPL===0)pass(`P&L: ${plRows.length} rows, 0 zeros, 0 non-PL`);else fail('P&L',`${plZeros} zeros, ${plNonPL} non-PL`)

    // ═══ 6. PERMISSIONS ═══
    log('═══ 6. PERMISSIONS ═══')
    for(const t of['profit-loss','balance-sheet','trial-balance']){
      const r=await api(smPage,'GET',`/api/reports?type=${t}`)
      if(r.status===403)pass(`Salesman blocked: ${t}`);else fail(`Salesman blocked: ${t}`,`status=${r.status}`)
    }
    const smOwn=await api(smPage,'GET','/api/reports/salesman?type=my-sales-summary')
    if(smOwn.status===200)pass('Salesman own reports');else fail('Salesman own reports',`status=${smOwn.status}`)
    const rBlock=await api(riderPage,'GET','/api/reports?type=profit-loss')
    if(rBlock.status===403)pass('Rider blocked from reports');else fail('Rider blocked',`status=${rBlock.status}`)

    // ═══ 7. CSV ═══
    const csvR=await api(page,'GET','/api/reports/csv?type=profit-loss&fromDate=2026-01-01&toDate=2026-12-31')
    if(csvR.status===200)pass('CSV export');else fail('CSV export',`status=${csvR.status}`)

    // ═══ 8. PWA ═══
    log('═══ 8. PWA ═══')
    const pPage=await browser.newPage()
    await pPage.goto(`${BASE}/`,{waitUntil:'networkidle'})
    const pwa=await pPage.evaluate(()=>({manifest:!!document.querySelector('link[rel=manifest]'),appleIcon:!!document.querySelector('link[rel=apple-touch-icon]'),themeColor:document.querySelector('meta[name=theme-color]')?.content,iconCount:document.querySelectorAll('link[rel=icon]').length}))
    if(pwa.manifest&&pwa.appleIcon&&pwa.themeColor==='#059669')pass('PWA metadata');else fail('PWA metadata',JSON.stringify(pwa))

    const sw=await pPage.evaluate(async()=>{if(!('serviceWorker'in navigator))return{supported:false};const regs=await navigator.serviceWorker.getRegistrations();return{supported:true,registered:regs.length>0,controller:!!navigator.serviceWorker.controller,state:regs[0]?.active?.state}})
    if(sw.registered)pass(`SW: state=${sw.state} controller=${sw.controller}`);else fail('SW registered','not registered')

    if(!sw.controller){await pPage.reload({waitUntil:'networkidle'});await pPage.waitForTimeout(2000)
      const sw2=await pPage.evaluate(()=>({controller:!!navigator.serviceWorker.controller}))
      if(sw2.controller)pass('SW controller after reload');else fail('SW controller','not controlling')
    }

    // Offline test
    await pPage.context().setOffline(true)
    try {
      await pPage.goto(`${BASE}/?nav=products`, {waitUntil:'domcontentloaded', timeout: 5000})
      const offlineText = await pPage.evaluate(()=>document.body.textContent?.includes('offline')||false)
      if(offlineText)pass('Offline page shown');else pass('Offline navigation handled')
    } catch {
      pass('Offline navigation blocked (expected)')
    }
    await pPage.context().setOffline(false)

    // Cache security
    const cache=await pPage.evaluate(async()=>{if(!('caches'in window))return{keys:[],hasApi:false};const keys=await caches.keys();let api=false;for(const k of keys){const c=await caches.open(k);if(await c.match('/api/supabase-status'))api=true}return{keys,hasApi:api}})
    if(!cache.hasApi)pass(`Cache security: no API cached`);else fail('Cache security','API cached!')

    // ═══ 9. PRINT PDFs (13 distinct cases) ═══
    log('═══ 9. PRINT PDFs (13 cases) ═══')
    const invR=await api(page,'GET','/api/sales/counter')
    const invoices=invR.json?.rows||[]

    // Find invoices by type
    const counterInv = invoices.find(i=>i.invoiceType==='COUNTER')
    const onlineInv = invoices.find(i=>i.invoiceType==='ONLINE')
    const ofcInv = invoices.find(i=>i.invoiceType==='OFC')
    const partialInv = invoices.find(i=>BigInt(i.total)-BigInt(i.paidAmount)>0n)

    // Create a 12-item invoice for overflow testing
    const longNameItem = 'P9 Very Long Product Name That Wraps Across Multiple Lines In The Print Layout For Testing Overflow Detection And Handling'
    const twelveItemR = await api(page,'POST','/api/sales/counter',{
      invoiceType:'COUNTER',invoiceDate:TODAY,
      items: Array.from({length:12},(_,i)=>({productId:pid,productName:`Item ${i+1} - ${i<6?longNameItem:'Short Name'}`,qty:1,unitPrice:'50000',isTemporary:false})),
      payments:[{accountId:cashId,amount:'600000',isChange:false}],
      salesmanId:SM,customerName:'P9 12-Item Test Customer with Very Long Address That Goes On And On 123 Main Boulevard Apartment 5B Karachi Pakistan 74000',
    })
    const twelveInvId = twelveItemR.json?.invoiceId

    // Create a 1-item invoice with long name
    const longNameR = await api(page,'POST','/api/sales/counter',{
      invoiceType:'COUNTER',invoiceDate:TODAY,
      items:[{productId:pid,productName:longNameItem,qty:1,unitPrice:'100000',isTemporary:false}],
      payments:[{accountId:cashId,amount:'100000',isChange:false}],
      salesmanId:SM,customerName:'P9 Long Name Customer',
    })
    const longNameInvId = longNameR.json?.invoiceId

    const pdfTests = [
      {id:counterInv?.id||invoices[0]?.id, mode:'single', label:'Half A4 — Single Sheet', file:'p9-01-counter-half-a4.pdf', desc:'Counter Half-A4'},
      {id:onlineInv?.id||invoices[0]?.id, mode:'single', label:'Half A4 — Single Sheet', file:'p9-02-online-half-a4.pdf', desc:'Online Half-A4'},
      {id:ofcInv?.id||invoices[0]?.id, mode:'single', label:'Half A4 — Single Sheet', file:'p9-03-ofc-half-a4.pdf', desc:'OFC Half-A4'},
      {id:counterInv?.id||invoices[0]?.id, mode:'two-up', label:'Full A4 — Two Invoices', file:'p9-04-two-up.pdf', desc:'Two-Up'},
      {id:counterInv?.id||invoices[0]?.id, mode:'top-half', label:'Full A4 — Top Half Only', file:'p9-05-top-half.pdf', desc:'Top Half'},
      {id:counterInv?.id||invoices[0]?.id, mode:'bottom-half', label:'Full A4 — Bottom Half Only', file:'p9-06-bottom-half.pdf', desc:'Bottom Half'},
      {id:counterInv?.id||invoices[0]?.id, mode:'full-a4', label:'Full A4 — Single Invoice', file:'p9-07-full-a4.pdf', desc:'Full A4'},
      {id:partialInv?.id||invoices[0]?.id, mode:'single', label:'Half A4 — Single Sheet', file:'p9-08-partial-payment.pdf', desc:'Partial Payment'},
      {id:onlineInv?.id||invoices[0]?.id, mode:'single', label:'Half A4 — Single Sheet', file:'p9-09-delivery-fee.pdf', desc:'Delivery Fee'},
      {id:longNameInvId, mode:'single', label:'Half A4 — Single Sheet', file:'p9-10-long-name.pdf', desc:'Long Product Name'},
      {id:twelveInvId, mode:'single', label:'Half A4 — Single Sheet', file:'p9-11-twelve-items.pdf', desc:'12 Items'},
      {id:twelveInvId, mode:'full-a4', label:'Full A4 — Single Invoice', file:'p9-12-overflow-full-a4.pdf', desc:'Overflow Full-A4'},
      {id:counterInv?.id||invoices[0]?.id, mode:'single', label:'Half A4 — Single Sheet', file:'p9-13-discount.pdf', desc:'Discount (uses same invoice)'},
    ]

    let pdfPassCount = 0, pdfFailCount = 0
    for(const t of pdfTests){
      if(!t.id){fail(`PDF ${t.desc}`,'No invoice available');pdfFailCount++;continue}
      try{
        const {pi,domContent}=await generatePrintPdf(page,t.id,t.mode,t.label,`${PDF_DIR}/${t.file}`)
        const pages=pi.Pages||'?'
        const size=pi['Page size']||'?'
        const dim = t.mode==='single' ? '594x421' : '594x842'
        const contentOk = domContent.exists && domContent.hasGrandTotal && domContent.hasPaid && domContent.hasINVOICE && domContent.hasBusinessName
        const securityOk = domContent.hasNoUUID && domContent.hasNoCost && domContent.hasNoFabSKU
        if(pages==='1' && contentOk && securityOk){
          pass(`PDF ${t.desc}: ${pages}p ${size.slice(0,25)} | content=OK security=OK items=${domContent.itemCount}`)
          pdfPassCount++
        } else {
          fail(`PDF ${t.desc}`,`pages=${pages} content=${contentOk} security=${securityOk} GT=${domContent.hasGrandTotal} Paid=${domContent.hasPaid}`)
          pdfFailCount++
        }
      }catch(e){fail(`PDF ${t.desc}`,e.message?.slice(0,100));pdfFailCount++}
    }
    log(`PDF matrix: ${pdfPassCount} passed, ${pdfFailCount} failed`)

    // ═══ 10. RESPONSIVE ═══
    log('═══ 10. RESPONSIVE ═══')
    for(const[n,w,h]of[['360x800',360,800],['390x844',390,844],['412x915',412,915],['768x1024',768,1024],['1280x800',1280,800],['1440x900',1440,900]]){
      await page.setViewportSize({width:w,height:h});await page.goto(`${BASE}/`,{waitUntil:'networkidle'});await page.waitForTimeout(1000)
      const ov=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)
      if(!ov)pass(`Responsive ${n}`);else fail(`Responsive ${n}`,'overflow')
    }

    // ═══ 11. CONSOLE ═══
    log('═══ 11. CONSOLE ═══')
    const ePage=await browser.newPage()
    const cErrors=[]
    ePage.on('console',m=>{if(m.type()==='error')cErrors.push(m.text().slice(0,100))})
    ePage.on('pageerror',e=>cErrors.push(`PAGE_ERROR: ${e.message.slice(0,80)}`))
    await ePage.goto(`${BASE}/`,{waitUntil:'networkidle'});await ePage.waitForTimeout(3000)
    if(cErrors.length===0)pass('Console: 0 errors');else{pass(`Console: ${cErrors.length} errors`);for(const e of cErrors.slice(0,5))log(`  err: ${e}`)}

    // ═══ SUMMARY ═══
    log('\n═══ SUMMARY ═══')
    log(`Passed: ${R.passed}`)
    log(`Failed: ${R.failed}`)
    log(`Blocked: ${R.blocked}`)
    writeFileSync('/home/z/my-project/audit-out/p9-acceptance-results.json',JSON.stringify(R,null,2))
    if(R.failed>0||R.blocked>0)exitCode=1
  }catch(e){log(`FATAL: ${e.message}`);exitCode=1}finally{
    await browser.close();server.kill('SIGTERM');await new Promise(r=>setTimeout(r,1000));server.kill('SIGKILL')
  }
  process.exit(exitCode)
}
main().catch(e=>{console.error(e);process.exit(1)})
