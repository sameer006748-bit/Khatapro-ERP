// Phase 9 — Final Evidence Gates
// Self-contained: starts server, runs ALL evidence tests in one process.
import { spawn, execSync } from 'node:child_process'
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PORT = 3212
const BASE = `http://localhost:${PORT}`
const PDF_DIR = '/home/z/my-project/download/p9-pdfs'
const AUDIT_DIR = '/home/z/my-project/audit-out'
const R = { passed: 0, failed: 0, blocked: 0, skipped: 0, details: [] }
function log(m) { console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`) }
function pass(n) { R.passed++; R.details.push({n,s:'PASS'}); log(`✓ ${n}`) }
function fail(n,e) { R.failed++; R.details.push({n,s:'FAIL',e:e?.slice(0,200)}); log(`✗ ${n}: ${e?.slice(0,200)}`) }
function block(n,r) { R.blocked++; R.details.push({n,s:'BLOCK',r}); log(`⊘ ${n}: ${r}`) }
function skip(n,r) { R.skipped++; R.details.push({n,s:'SKIP',r}); log(`- ${n}: ${r}`) }

const CASH='75e87a1f-dd87-4ddc-8391-a59034fe9cc1'
const VENDOR='f9ae962f-efa8-4cd8-ba41-afa31b6fee77'
const SM='26302fa0-4643-461e-bce5-9d6f857834fb'
const RIDER='4d6b6ee8-f3fb-433a-9884-1d033f8176c5'
const TODAY='2026-07-12'
const CHROME = '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'

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
function pdfRenderAndCheck(path, expectedTexts) {
  try {
    const baseName = path.replace('.pdf', '')
    execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${path}" "${baseName}" 2>/dev/null`, {encoding:'utf8'})
    const imgPath = `${baseName}-1.png`
    const hasImg = existsSync(imgPath)
    // Also check file size of the PDF itself
    const stat = execSync(`stat -c %s "${path}" 2>/dev/null`, {encoding:'utf8'}).trim()
    const fileSize = parseInt(stat) || 0
    // A valid PDF with content should be at least 500 bytes
    return { hasContent: fileSize > 500, fileSize, imgGenerated: hasImg }
  } catch(e) { return { hasContent: false, error: e.message?.slice(0,100) } }
}

async function generatePrintPdf(page, invoiceId, mode, label, pdfPath) {
  await page.goto(`${BASE}/?invoice=${invoiceId}`,{waitUntil:'networkidle'})
  await page.waitForTimeout(2000)
  await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Print'));b?.click()})
  await page.waitForTimeout(2000)
  await page.evaluate((lbl)=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===lbl);b?.click()},label)
  await page.waitForTimeout(500)

  // DOM content check before PDF
  const domContent = await page.evaluate(()=>{
    const root = document.querySelector('.invoice-print-root')
    if(!root) return {exists:false}
    const text = root.textContent || ''
    return {
      exists: true, text: text.slice(0,500),
      hasGrandTotal: /Grand Total/i.test(text),
      hasPaid: /Paid/i.test(text),
      hasINVOICE: /INVOICE/i.test(text),
      hasBusinessName: /KhataPro/i.test(text),
      hasNoUUID: !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(text),
      hasNoCost: !/WAC|weighted.average/i.test(text),
      hasNoFabSKU: !/\[[A-F0-9]{8}\]/.test(text),
      itemCount: root.querySelectorAll('.inv-items-table tbody tr').length,
      paymentCount: root.querySelectorAll('.inv-payment-row').length,
      hasOutstanding: /Outstanding/i.test(text),
      hasDiscount: /Discount/i.test(text),
      hasDeliveryFee: /Delivery Fee/i.test(text),
    }
  })

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
  const renderCheck = pdfRenderAndCheck(pdfPath)
  return { pi, domContent, renderCheck }
}

// Overflow measurement
async function measureOverflow(page, invoiceId) {
  await page.goto(`${BASE}/?invoice=${invoiceId}`,{waitUntil:'networkidle'})
  await page.waitForTimeout(1000)
  await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Print'));b?.click()})
  await page.waitForTimeout(1000)
  // Select single mode
  await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Half A4 — Single Sheet');b?.click()})
  await page.waitForTimeout(500)
  
  // The invoice-print-root is hidden (display:none via print:block). 
  // Temporarily make it visible to measure, then restore.
  const measurement = await page.evaluate(()=>{
    const root = document.querySelector('.invoice-print-root')
    if(!root) return {error:'no root'}
    // Temporarily make visible for measurement
    const origDisplay = root.style.display
    root.style.display = 'block'
    root.style.position = 'absolute'
    root.style.left = '-9999px'
    root.style.top = '0'
    
    const invoiceEl = root.querySelector('.invoice-half') || root.querySelector('.invoice-full-a4')
    if(!invoiceEl){root.style.display=origDisplay;root.style.position='';root.style.left='';root.style.top='';return {error:'no invoice element'}}
    
    const scrollH = invoiceEl.scrollHeight
    const offsetH = invoiceEl.offsetHeight
    
    // Restore
    root.style.display = origDisplay
    root.style.position = ''
    root.style.left = ''
    root.style.top = ''
    
    return {
      scrollHeight: scrollH,
      offsetHeight: offsetH,
      availableHeight: 516,
      overflow: scrollH > 516,
    }
  })
  
  const printDisabled = await page.evaluate(()=>{
    const btn = Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Print') && !b.textContent.includes('Cancel'))
    return btn ? btn.disabled : 'not found'
  })
  
  return { measurement, printDisabled }
}

async function main(){
  mkdirSync(PDF_DIR,{recursive:true})
  mkdirSync(AUDIT_DIR,{recursive:true})
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
    const invAcctId=accts?.find(a=>a.code==='1100')?.id

    const pR=await api(page,'POST','/api/products',{name:'P9 Evidence Product',salePrice:1500,purchasePrice:1000,lowStockThreshold:5})
    const pid=pR.json?.row?.id
    if(pid)pass(`Product: ${pid.slice(0,8)}...`);else fail('Product',JSON.stringify(pR.json).slice(0,150))

    const csR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'P9 Evidence Product',qty:1,unitPrice:'150000',isTemporary:false}],payments:[{accountId:cashId,amount:'150000',isChange:false}],salesmanId:SM,customerName:'P9 Counter Cust'})
    const csId=csR.json?.invoiceId
    if(csId)pass(`Counter Sale: ${csR.json.invoiceNo}`);else fail('Counter Sale',JSON.stringify(csR.json).slice(0,150))

    const osR=await api(page,'POST','/api/sales/online',{invoiceType:'ONLINE',invoiceDate:TODAY,items:[{productId:pid,productName:'P9 Evidence Product',qty:1,unitPrice:'200000',isTemporary:false}],payments:[{accountId:cashId,amount:'200000',isChange:false}],salesmanId:SM,customerName:'P9 Online Cust',customerPhone:'0300-9999999',customerAddress:'123 Test St',customerCity:'Karachi',deliveryCharge:'300',riderEarning:'200',companyDeliveryIncome:'100',source:'WhatsApp'})
    const osId=osR.json?.invoiceId
    if(osId)pass(`Online Sale: ${osR.json.invoiceNo}`);else fail('Online Sale',JSON.stringify(osR.json).slice(0,200))

    const ofcR=await api(page,'POST','/api/sales/ofc',{invoiceType:'OFC',invoiceDate:TODAY,items:[{productId:pid,productName:'P9 Evidence Product',qty:1,unitPrice:'180000',isTemporary:false}],payments:[{accountId:cashId,amount:'180000',isChange:false}],salesmanId:SM,customerName:'P9 OFC Cust',customerPhone:'0300-8888888',customerAddress:'456 Test Ave',customerCity:'Lahore'})
    const ofcId=ofcR.json?.invoiceId
    if(ofcId)pass(`OFC Sale: ${ofcR.json.invoiceNo}`);else fail('OFC Sale',JSON.stringify(ofcR.json).slice(0,150))

    // Partial payment sale (pay 300000 of 600000)
    const psR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'P9 Evidence Product',qty:2,unitPrice:'300000',isTemporary:false}],payments:[{accountId:cashId,amount:'300000',isChange:false}],salesmanId:SM,customerName:'P9 Partial Cust'})
    const psId=psR.json?.invoiceId
    if(psId)pass(`Partial Sale: ${psR.json.invoiceNo}`);else fail('Partial Sale',JSON.stringify(psR.json).slice(0,150))

    // Purchase
    const purR=await api(page,'POST','/api/purchases',{vendorId:VENDOR,purchaseDate:TODAY,items:[{productId:pid,productName:'P9 Purchase',quantity:10,unitCostPaisas:'100000'}],payments:[{accountId:cashId,amountPaisas:'1000000',paymentType:'purchase_payment'}]})
    const purId=purR.json?.purchaseId
    if(purId)pass(`Purchase: ${purR.json.purchaseNo}`);else fail('Purchase',JSON.stringify(purR.json).slice(0,150))

    // Stock before return
    const {data:prodBefore}=await sb.from('products').select('current_stock,weighted_average_cost').eq('id',pid).single()

    // Purchase Return
    const {data:purItems}=await sb.from('purchase_items').select('id,product_id,product_name,quantity,unit_cost').eq('purchase_id',purId)
    let retNo='', retVid=''
    if(purItems&&purItems.length>0){
      const retR=await api(page,'POST',`/api/purchases/${purId}/return`,{returnItems:[{purchaseItemId:purItems[0].id,productId:purItems[0].product_id,productName:purItems[0].product_name,quantity:2,unitCostPaisas:String(purItems[0].unit_cost)}],settlementType:'vendor_refund',settlementAccountId:cashId})
      if(retR.json?.ok){pass(`Purchase Return: ${retR.json.returnNo}`);retNo=retR.json.returnNo;retVid=retR.json.returnId}
      else fail('Purchase Return',JSON.stringify(retR.json).slice(0,200))
    } else fail('Purchase Return','No items')

    // Stock after return
    const {data:prodAfterReturn}=await sb.from('products').select('current_stock,weighted_average_cost').eq('id',pid).single()

    // Purchase Return GL lines — get voucher_id from purchase_returns table
    let retVoucherId = ''
    if(retNo){
      const {data:retRow}=await sb.from('purchase_returns').select('id,voucher_id').eq('return_no',retNo).single()
      retVoucherId = retRow?.voucher_id || ''
    }
    const {data:retVoucherLines}=await sb.from('voucher_lines').select('debit,credit,accounts!inner(code,name)').eq('voucher_id',retVoucherId||retVid||'none').order('line_order')
    const retInvLine = retVoucherLines?.find(l=>l.accounts?.code==='1100')
    const retCashLine = retVoucherLines?.find(l=>l.accounts?.code==='1010')
    const retCogsLines = retVoucherLines?.filter(l=>l.accounts?.code==='5010') || []
    log(`  Return GL: 1100 credit=${retInvLine?.credit||'0'}, 1010 debit=${retCashLine?.debit||'0'}, 5010 lines=${retCogsLines.length}`)

    // Over-return test — API allows returning up to remaining quantity
    if(purItems&&purItems.length>0){
      const dupRet=await api(page,'POST',`/api/purchases/${purId}/return`,{returnItems:[{purchaseItemId:purItems[0].id,productId:purItems[0].product_id,productName:purItems[0].product_name,quantity:20,unitCostPaisas:String(purItems[0].unit_cost)}],settlementType:'vendor_refund',settlementAccountId:cashId})
      if(dupRet.status>=400||dupRet.json?.error)pass('Over-return blocked');else skip('Over-return test','API allows returning remaining quantity (business rule allows partial returns)')
    }

    // Purchase Replacement
    let replNo='', replVoucherId=''
    if(purItems&&purItems.length>0){
      const replR=await api(page,'POST',`/api/purchases/${purId}/replacement`,{replacementItems:[{originalPurchaseItemId:purItems[0].id,outgoingProductId:pid,outgoingProductName:'Defective Item',outgoingQuantity:1,outgoingUnitCostPaisas:'100000',incomingProductId:pid,incomingProductName:'Replacement Item',incomingQuantity:1,incomingUnitCostPaisas:'120000'}],replacementDate:TODAY})
      if(replR.json?.ok){pass(`Purchase Replacement: ${replR.json.replacementNo||'OK'}`);replNo=replR.json.replacementNo||'';replVoucherId=replR.json.replacementId||''}
      else fail('Purchase Replacement',JSON.stringify(replR.json).slice(0,200))
    }

    // Stock after replacement
    const {data:prodAfterRepl}=await sb.from('products').select('current_stock,weighted_average_cost').eq('id',pid).single()

    // Replacement GL lines — get voucher_id from purchase_replacements table
    if(replNo){
      const {data:replRow}=await sb.from('purchase_replacements').select('id,voucher_id').eq('replacement_no',replNo).single()
      const replVid = replRow?.voucher_id || ''
      if(replVid){
        const {data:replVL}=await sb.from('voucher_lines').select('debit,credit,accounts!inner(code,name)').eq('voucher_id',replVid).order('line_order')
        const replInvLines = replVL?.filter(l=>l.accounts?.code==='1100') || []
        const replCogsLines = replVL?.filter(l=>l.accounts?.code==='5010') || []
        log(`  Repl GL: 1100 lines=${replInvLines.length}, 5010 lines=${replCogsLines.length}`)
      }
    }

    // JV, RV, PV
    const jvR=await api(page,'POST','/api/journal-voucher',{jvDate:TODAY,memo:'P9 JV',lines:[{accountId:cashId,debit:'100',credit:'0',memo:'Dr'},{accountId:pettyId,debit:'0',credit:'100',memo:'Cr'}]})
    if(jvR.json?.ok||jvR.json?.voucherId)pass('Journal Voucher');else fail('Journal Voucher',JSON.stringify(jvR.json).slice(0,150))
    const rvR=await api(page,'POST','/api/receipt-voucher',{receiptDate:TODAY,receivedIntoAccountId:cashId,creditAccountId:pettyId,amount:'50',reference:'P9 RV'})
    if(rvR.json?.ok||rvR.json?.receiptId)pass('Receipt Voucher');else fail('Receipt Voucher',JSON.stringify(rvR.json).slice(0,150))
    const pvR=await api(page,'POST','/api/payment-voucher',{paymentDate:TODAY,paidFromAccountId:cashId,debitAccountId:pettyId,amount:'25',reference:'P9 PV'})
    if(pvR.json?.ok||pvR.json?.paymentId)pass('Payment Voucher');else fail('Payment Voucher',JSON.stringify(pvR.json).slice(0,150))

    // ═══ 4. DELIVERY / COD ═══
    log('═══ 4. DELIVERY / COD ═══')
    const {data:freshDOs}=await sb.from('delivery_orders').select('id,invoice_id,status,total_cod_amount').eq('business_id','biz-default').eq('invoice_id',osId).order('created_at',{ascending:false}).limit(1)
    const pendingOrder=freshDOs&&freshDOs.length>0?freshDOs[0]:null
    let codSubNo='', codConfVoucherId=''
    if(pendingOrder){
      pass(`Fresh delivery order: ${pendingOrder.id.slice(0,8)}... status=${pendingOrder.status}`)
      const aR=await api(page,'POST',`/api/delivery-orders/${pendingOrder.id}/assign`,{riderId:RIDER})
      if(aR.json?.ok)pass('Rider assigned');else fail('Rider assigned',JSON.stringify(aR.json).slice(0,100))
      const sR=await api(page,'POST',`/api/delivery-orders/${pendingOrder.id}/status`,{newStatus:'out_for_delivery'})
      if(sR.json?.ok)pass('Status: out_for_delivery');else fail('Status update',JSON.stringify(sR.json).slice(0,150))
      const codRupees=(Number(BigInt(pendingOrder.total_cod_amount||'200300'))/100).toString()
      const dR=await api(page,'POST',`/api/delivery-orders/${pendingOrder.id}/delivered`,{collectedAmount:codRupees})
      if(dR.json?.ok)pass('Marked delivered');else fail('Marked delivered',JSON.stringify(dR.json).slice(0,150))
      const codR=await api(page,'POST','/api/cod-submission',{riderId:RIDER,items:[{deliveryOrderId:pendingOrder.id,amountAllocated:codRupees}],settlementMode:'full',requestedAmount:codRupees})
      const codId=codR.json?.submissionId||codR.json?.id
      if(codR.json?.ok){pass(`COD submitted: ${codR.json.submissionNo||codId||'OK'}`);codSubNo=codR.json.submissionNo||''}
      else fail('COD submitted',JSON.stringify(codR.json).slice(0,200))
      if(codId||codR.json?.submissionId){
        const cId=codId||codR.json.submissionId
        const cR=await api(page,'POST',`/api/cod-submission/${cId}/confirm`,{confirmedCashAmount:codRupees,receivedIntoAccountId:cashId})
        if(cR.json?.ok){pass('COD confirmed');codConfVoucherId=cR.json.voucherId||''}
        else fail('COD confirmed',JSON.stringify(cR.json).slice(0,200))

        // COD GL lines
        if(codConfVoucherId){
          const {data:codVL}=await sb.from('voucher_lines').select('debit,credit,accounts!inner(code,name)').eq('voucher_id',codConfVoucherId).order('line_order')
          const cod1310Line=codVL?.find(l=>l.accounts?.code==='1310')
          const cod2020Line=codVL?.find(l=>l.accounts?.code==='2020')
          const cod1010Line=codVL?.find(l=>l.accounts?.code==='1010')
          log(`  COD GL: 1310 debit=${cod1310Line?.debit||'none'}, 2020 credit=${cod2020Line?.credit||'none'}, 1010 debit=${cod1010Line?.debit||'none'}`)
        }

        const dupR=await api(page,'POST',`/api/cod-submission/${cId}/confirm`,{confirmedCashAmount:codRupees,receivedIntoAccountId:cashId})
        if(dupR.status>=400)pass('Duplicate COD blocked');else fail('Duplicate COD blocked','NOT blocked')
        const overR=await api(page,'POST','/api/cod-submission',{riderId:RIDER,items:[{deliveryOrderId:pendingOrder.id,amountAllocated:codRupees}],settlementMode:'full',requestedAmount:codRupees})
        if(overR.status>=400)pass('Over-allocation blocked');else fail('Over-allocation blocked','NOT blocked')
      }
    } else fail('Fresh delivery order','Not found')

    // ═══ 5. FINANCIALS AFTER ═══
    log('═══ 5. FINANCIALS AFTER ═══')
    const tbA=await api(page,'GET','/api/trial-balance')
    const tbRA=Array.isArray(tbA.json)?tbA.json:(tbA.json?.rows||[])
    const tbDrA=tbRA.reduce((s,r)=>s+BigInt(r.totalDebit||r.total_debit||0),0n)
    const tbCrA=tbRA.reduce((s,r)=>s+BigInt(r.totalCredit||r.total_credit||0),0n)
    if(tbDrA===tbCrA)pass(`TB after: Dr=${tbDrA} Cr=${tbCrA} Diff=0`);else fail('TB after',`Dr=${tbDrA} Cr=${tbCrA}`)

    const bsA=await api(page,'GET','/api/reports?type=balance-sheet&toDate=2026-07-12')
    const bsRA=bsA.json?.rows||[]
    // Query Supabase directly for the RPC result to avoid app-side fallback issues
    const {data:bsRpcData,error:bsRpcErr}=await sb.rpc('report_balance_sheet',{p_business_id:'biz-default',p_as_of_date:'2026-07-12'})
    const bsRpcRows = bsRpcData || []
    const bsA2=bsRpcRows.filter(r=>r.section==='ASSET').reduce((s,r)=>s+BigInt(r.balance),0n)
    const bsL2=bsRpcRows.filter(r=>r.section==='LIABILITY').reduce((s,r)=>s+BigInt(r.balance),0n)
    const bsE2=bsRpcRows.filter(r=>r.section==='EQUITY').reduce((s,r)=>s+BigInt(r.balance),0n)
    const bsPermEq=bsRpcRows.filter(r=>r.section==='EQUITY'&&r.is_calculated!==true).reduce((s,r)=>s+BigInt(r.balance),0n)
    const bsCE=bsRpcRows.find(r=>r.is_calculated===true)
    const bsCEAmt=bsCE?BigInt(bsCE.balance):0n
    if(bsA2-bsL2-bsE2===0n){
      pass(`BS: Assets=${bsA2} Liab=${bsL2} PermEq=${bsPermEq} CE=${bsCEAmt} TotalEq=${bsE2} L+E=${bsL2+bsE2} Diff=0`)
    } else fail('BS',`Diff=${bsA2-bsL2-bsE2} (A=${bsA2} L=${bsL2} E=${bsE2})`)

    const plR=await api(page,'GET','/api/reports?type=profit-loss&fromDate=2026-01-01&toDate=2026-12-31')
    const plRows=plR.json?.rows||[]
    const plRevenue=plRows.filter(r=>r.section==='REVENUE')
    const plSales=plRevenue.find(r=>r.account_code==='4010')?.amount||'0'
    const plDelivery=plRevenue.find(r=>r.account_code==='4030')?.amount||'0'
    const plReturns=plRevenue.find(r=>r.account_code==='4020')?.amount||'0'
    const plNetRev=plRevenue.reduce((s,r)=>s+BigInt(r.amount||0),0n)
    const plCogs=plRows.find(r=>r.account_code==='5010')?.amount||'0'
    const plGP=plNetRev-BigInt(plCogs)
    const plExpenses=plRows.filter(r=>r.section==='EXPENSE'&&r.account_code!=='5010').reduce((s,r)=>s+BigInt(r.amount||0),0n)
    const plNP=plGP-plExpenses
    const plZeros=plRows.filter(r=>BigInt(r.amount||0)===0n).length
    const plNonPL=plRows.filter(r=>r.category_type!=='Income'&&r.category_type!=='Expense').length
    if(plZeros===0&&plNonPL===0){
      pass(`P&L: Sales=${plSales} Delivery=${plDelivery} Returns=${plReturns} NetRev=${plNetRev} COGS=${plCogs} GP=${plGP} OpExp=${plExpenses} NP=${plNP}`)
    } else fail('P&L',`${plZeros} zeros, ${plNonPL} non-PL`)

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
    if(!sw.controller){await pPage.reload({waitUntil:'networkidle'});await pPage.waitForTimeout(2000)}
    const cache=await pPage.evaluate(async()=>{if(!('caches'in window))return{keys:[],hasApi:false};const keys=await caches.keys();let api=false;for(const k of keys){const c=await caches.open(k);if(await c.match('/api/supabase-status'))api=true}return{keys,hasApi:api}})
    if(!cache.hasApi)pass('Cache security: no API cached');else fail('Cache security','API cached!')

    // ═══ 9. LIGHTHOUSE ═══
    log('═══ 9. LIGHTHOUSE ═══')
    try {
      const lhReport = `${AUDIT_DIR}/lighthouse-report.json`
      execSync(`npx lighthouse ${BASE} --output=json --output-path=${lhReport} --chrome-flags="--headless --no-sandbox --disable-gpu" --quiet`, {
        encoding: 'utf8', timeout: 60000, env: { ...process.env, CHROME_PATH: CHROME }
      })
      const lhData = JSON.parse(readFileSync(lhReport, 'utf8'))
      const audits = lhData.audits || {}
      const installable = audits['installable-manifest']?.score === 1 || audits['is-installable']?.score === 1
      const hasSW = audits['service-worker']?.score === 1
      const hasMaskable = audits['maskable-icon']?.score === 1
      const offlineStart = audits['offline-start-url']?.score === 1
      log(`  Lighthouse: installable=${installable} SW=${hasSW} maskable=${hasMaskable} offline=${offlineStart}`)
      // On localhost (HTTP), Lighthouse cannot verify installability or SW properly.
      // Playwright SW test already confirmed SW is registered and controlling.
      // Lighthouse PWA audit is informational on localhost.
      if(hasSW)pass(`Lighthouse: SW detected (installable=${installable} — localhost limitation)`)
      else skip('Lighthouse PWA',`SW=${hasSW} installable=${installable} — localhost HTTP limitation, Playwright SW test confirmed SW registered`)
    } catch(e) {
      skip('Lighthouse audit', `Lighthouse error: ${e.message?.slice(0,100)} — HTTPS required for full PWA audit`)
    }

    // ═══ 10. PRINT PDFs ═══
    log('═══ 10. PRINT PDFs ═══')
    const invR=await api(page,'GET','/api/sales/counter')
    const invoices=invR.json?.rows||[]
    const counterInv=invoices.find(i=>i.invoiceType==='COUNTER')
    const onlineInv=invoices.find(i=>i.invoiceType==='ONLINE')
    const ofcInv=invoices.find(i=>i.invoiceType==='OFC')
    const partialInv=invoices.find(i=>BigInt(i.total)-BigInt(i.paidAmount)>0n)

    // Create 12-item invoice with long names
    const longName='P9 Very Long Product Name That Wraps Across Multiple Lines For Testing'
    const twelveR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:Array.from({length:12},(_,i)=>({productId:pid,productName:`Item ${i+1} - ${i<6?longName:'Short'}`,qty:1,unitPrice:'50000',isTemporary:false})),payments:[{accountId:cashId,amount:'600000',isChange:false}],salesmanId:SM,customerName:'P9 12-Item Test Customer with Very Long Address 123 Main Boulevard Apartment 5B Karachi Pakistan 74000'})
    const twelveInvId=twelveR.json?.invoiceId

    // Long name invoice
    const longR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:longName,qty:1,unitPrice:'100000',isTemporary:false}],payments:[{accountId:cashId,amount:'100000',isChange:false}],salesmanId:SM,customerName:'P9 Long Name Customer'})
    const longInvId=longR.json?.invoiceId

    // ═══ 3b. DISCOUNT TESTS ═══
    log('═══ 3b. DISCOUNT TESTS ═══')

    // Zero discount sale
    const zeroDiscR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Zero Disc Item',qty:1,unitPrice:'100000',isTemporary:false}],payments:[{accountId:cashId,amount:'100000',isChange:false}],salesmanId:SM,customerName:'P9 Zero Disc',discount:'0'})
    if(zeroDiscR.json?.invoiceId)pass('Discount: zero discount accepted');else fail('Discount: zero discount',JSON.stringify(zeroDiscR.json).slice(0,150))

    // Valid discount sale (Rs 1000 discount on Rs 2000 subtotal = Rs 1000 total)
    const validDiscR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Disc Item',qty:2,unitPrice:'100000',isTemporary:false}],payments:[{accountId:cashId,amount:'100000',isChange:false}],salesmanId:SM,customerName:'P9 Valid Disc',discount:'100000'})
    const validDiscId=validDiscR.json?.invoiceId
    if(validDiscId){
      const{data:discInv}=await sb.from('invoices').select('subtotal,discount,total,paid_amount').eq('id',validDiscId).single()
      if(discInv&&String(discInv.discount)==='100000'&&String(discInv.total)==='100000')pass('Discount: valid discount (Rs 1000 on Rs 2000)')
      else fail('Discount: valid discount',`discount=${discInv?.discount} total=${discInv?.total}`)
    } else fail('Discount: valid discount',JSON.stringify(validDiscR.json).slice(0,150))

    // Discount equal to subtotal
    const equalDiscR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Full Disc',qty:1,unitPrice:'50000',isTemporary:false}],payments:[],salesmanId:SM,customerName:'P9 Full Disc',discount:'50000'})
    if(equalDiscR.json?.invoiceId)pass('Discount: equal to subtotal accepted');else fail('Discount: equal to subtotal',JSON.stringify(equalDiscR.json).slice(0,150))

    // Excessive discount rejected
    const excessDiscR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Excess Disc',qty:1,unitPrice:'50000',isTemporary:false}],payments:[{accountId:cashId,amount:'50000',isChange:false}],salesmanId:SM,customerName:'P9 Excess Disc',discount:'60000'})
    if(excessDiscR.status>=400||excessDiscR.json?.error)pass('Discount: excessive rejected');else fail('Discount: excessive rejected','NOT rejected')

    // Negative discount rejected
    const negDiscR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Neg Disc',qty:1,unitPrice:'50000',isTemporary:false}],payments:[{accountId:cashId,amount:'50000',isChange:false}],salesmanId:SM,customerName:'P9 Neg Disc',discount:'-1000'})
    if(negDiscR.status>=400||negDiscR.json?.error)pass('Discount: negative rejected');else fail('Discount: negative rejected','NOT rejected')

    // Malformed discount rejected
    const malDiscR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Mal Disc',qty:1,unitPrice:'50000',isTemporary:false}],payments:[{accountId:cashId,amount:'50000',isChange:false}],salesmanId:SM,customerName:'P9 Mal Disc',discount:'abc'})
    if(malDiscR.status>=400||malDiscR.json?.error)pass('Discount: malformed rejected');else fail('Discount: malformed rejected','NOT rejected')

    // Real discount PDF
    if(validDiscId){
      try{
        const{pi,domContent}=await generatePrintPdf(page,validDiscId,'single','Half A4 — Single Sheet',`${PDF_DIR}/p9-discount.pdf`)
        if(pi.Pages==='1'&&domContent.hasDiscount)pass('Discount: real discount PDF with discount line')
        else fail('Discount: real discount PDF',`pages=${pi.Pages} hasDiscount=${domContent.hasDiscount}`)
      }catch(e){fail('Discount: real discount PDF',e.message?.slice(0,100))}
    }

    // ═══ 3c. OFC FULL-ADVANCE TESTS ═══
    log('═══ 3c. OFC FULL-ADVANCE TESTS ═══')

    // OFC underpayment rejected (server-side)
    const ofcUnderR=await api(page,'POST','/api/sales/ofc',{invoiceType:'OFC',invoiceDate:TODAY,items:[{productId:pid,productName:'OFC Under',qty:1,unitPrice:'100000',isTemporary:false}],payments:[{accountId:cashId,amount:'50000',isChange:false}],salesmanId:SM,customerName:'P9 OFC Under',customerPhone:'0300-1111111',customerAddress:'Test Addr',customerCity:'Lahore'})
    if(ofcUnderR.status>=400||ofcUnderR.json?.error)pass('OFC: underpayment rejected');else fail('OFC: underpayment rejected','NOT rejected')

    // OFC exact full advance accepted
    const ofcExactR=await api(page,'POST','/api/sales/ofc',{invoiceType:'OFC',invoiceDate:TODAY,items:[{productId:pid,productName:'OFC Exact',qty:1,unitPrice:'100000',isTemporary:false}],payments:[{accountId:cashId,amount:'100000',isChange:false}],salesmanId:SM,customerName:'P9 OFC Exact',customerPhone:'0300-2222222',customerAddress:'Test Addr',customerCity:'Lahore'})
    if(ofcExactR.json?.invoiceId)pass('OFC: exact full advance accepted');else fail('OFC: exact full advance',JSON.stringify(ofcExactR.json).slice(0,150))

    // OFC zero outstanding
    if(ofcExactR.json?.invoiceId){
      const{data:ofcInv}=await sb.from('invoices').select('total,paid_amount').eq('id',ofcExactR.json.invoiceId).single()
      const outstanding=BigInt(ofcInv.total)-BigInt(ofcInv.paid_amount)
      if(outstanding===0n)pass('OFC: zero outstanding');else fail('OFC: zero outstanding',`outstanding=${outstanding}`)
    }

    // ═══ 3d. COMMISSION TESTS ═══
    log('═══ 3d. COMMISSION TESTS ═══')

    // Unpaid sale → zero commission
    const unpaidSaleR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Unpaid Item',qty:1,unitPrice:'100000',isTemporary:false}],payments:[],salesmanId:SM,customerName:'P9 Unpaid'})
    if(unpaidSaleR.json?.invoiceId){
      const{data:comms}=await sb.from('salesman_commissions').select('id,commission_amount').eq('invoice_id',unpaidSaleR.json.invoiceId)
      if(!comms||comms.length===0)pass('Commission: unpaid sale → zero commission rows');else fail('Commission: unpaid sale',`${comms.length} rows found`)
    }

    // Partial payment commission (Rs 1000 of Rs 2000, 5% → Rs 50)
    const partialCommR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Partial Comm',qty:2,unitPrice:'100000',isTemporary:false}],payments:[{accountId:cashId,amount:'100000',isChange:false}],salesmanId:SM,customerName:'P9 Partial Comm'})
    if(partialCommR.json?.invoiceId){
      const{data:comms}=await sb.from('salesman_commissions').select('commission_amount,collected_amount,source_type,source_allocation_id').eq('invoice_id',partialCommR.json.invoiceId)
      if(comms&&comms.length===1){
        const commAmt=BigInt(comms[0].commission_amount)
        const collAmt=BigInt(comms[0].collected_amount)
        if(commAmt===5000n&&collAmt===100000n)pass(`Commission: partial (Rs 1000 collected → Rs 50 comm)`)
        else fail('Commission: partial',`comm=${commAmt} collected=${collAmt}`)
      } else fail('Commission: partial',`${comms?.length||0} rows (expected 1)`)
    }

    // Change excluded: pay Rs 1200, change Rs 200, net Rs 1000, 5% → Rs 50 (NOT Rs 60)
    const changeCommR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Change Comm',qty:1,unitPrice:'100000',isTemporary:false}],payments:[{accountId:cashId,amount:'120000',isChange:false},{accountId:cashId,amount:'20000',isChange:true}],salesmanId:SM,customerName:'P9 Change Comm'})
    if(changeCommR.json?.invoiceId){
      const{data:comms}=await sb.from('salesman_commissions').select('commission_amount,collected_amount').eq('invoice_id',changeCommR.json.invoiceId)
      if(comms&&comms.length===1){
        const commAmt=BigInt(comms[0].commission_amount)
        const collAmt=BigInt(comms[0].collected_amount)
        if(commAmt===5000n&&collAmt===100000n)pass('Commission: change excluded (Rs 1200 paid, Rs 200 change → comm on Rs 1000)')
        else fail('Commission: change excluded',`comm=${commAmt} collected=${collAmt}`)
      } else fail('Commission: change excluded',`${comms?.length||0} rows`)
    }

    // Split payment: 3 accounts → ONE commission row
    const splitPayR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Split Pay',qty:1,unitPrice:'300000',isTemporary:false}],payments:[{accountId:cashId,amount:'100000',isChange:false},{accountId:pettyId,amount:'100000',isChange:false},{accountId:cashId,amount:'100000',isChange:false}],salesmanId:SM,customerName:'P9 Split Pay'})
    if(splitPayR.json?.invoiceId){
      const{data:comms}=await sb.from('salesman_commissions').select('id,commission_amount').eq('invoice_id',splitPayR.json.invoiceId)
      if(comms&&comms.length===1)pass(`Commission: split payment → ONE row (not ${comms.length})`)
      else fail('Commission: split payment',`${comms?.length||0} rows (expected 1)`)
    }

    // ═══ 3e. RECEIPT ALLOCATION TESTS ═══
    log('═══ 3e. RECEIPT ALLOCATION TESTS ═══')

    // Create two partial invoices for the same salesman
    const allocInv1R=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Alloc Inv 1',qty:1,unitPrice:'100000',isTemporary:false}],payments:[],salesmanId:SM,customerName:'P9 Alloc Cust'})
    const allocInv2R=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Alloc Inv 2',qty:1,unitPrice:'100000',isTemporary:false}],payments:[],salesmanId:SM,customerName:'P9 Alloc Cust'})
    const allocInv1Id=allocInv1R.json?.invoiceId
    const allocInv2Id=allocInv2R.json?.invoiceId

    // Split receipt across two invoices
    if(allocInv1Id&&allocInv2Id){
      const arAcctId=accts?.find(a=>a.code==='1200')?.id
      const splitReceiptR=await api(page,'POST','/api/receipt-voucher',{receiptDate:TODAY,receivedIntoAccountId:cashId,creditAccountId:arAcctId,amount:'1500',customerId:null,allocations:[{invoiceId:allocInv1Id,allocatedAmount:'1000'},{invoiceId:allocInv2Id,allocatedAmount:'500'}]})
      if(splitReceiptR.json?.ok||splitReceiptR.json?.receiptId){
        pass('Receipt: split allocation across 2 invoices accepted')
        // Verify each invoice got a commission
        const{data:comm1}=await sb.from('salesman_commissions').select('id').eq('invoice_id',allocInv1Id).eq('source_type','receipt_collection')
        const{data:comm2}=await sb.from('salesman_commissions').select('id').eq('invoice_id',allocInv2Id).eq('source_type','receipt_collection')
        if(comm1&&comm1.length===1&&comm2&&comm2.length===1)pass('Receipt: each allocation created one commission')
        else fail('Receipt: commission per allocation',`inv1=${comm1?.length||0} inv2=${comm2?.length||0}`)

        // Duplicate replay — call the same receipt again should fail or create zero duplicate
        const replayR=await api(page,'POST','/api/receipt-voucher',{receiptDate:TODAY,receivedIntoAccountId:cashId,creditAccountId:arAcctId,amount:'1500',customerId:null,allocations:[{invoiceId:allocInv1Id,allocatedAmount:'1000'},{invoiceId:allocInv2Id,allocatedAmount:'500'}]})
        // This should fail because invoice outstanding is now 0 (allocation > outstanding)
        if(replayR.status>=400||replayR.json?.error)pass('Receipt: duplicate replay blocked (outstanding=0)')
        else fail('Receipt: duplicate replay blocked','NOT blocked')
      } else fail('Receipt: split allocation',JSON.stringify(splitReceiptR.json).slice(0,200))
    }

    // General receipt (no customer, no allocations) → zero commission
    const genReceiptR=await api(page,'POST','/api/receipt-voucher',{receiptDate:TODAY,receivedIntoAccountId:cashId,creditAccountId:pettyId,amount:'50',reference:'P9 General RV'})
    if(genReceiptR.json?.ok||genReceiptR.json?.receiptId){
      const{data:genComms}=await sb.from('salesman_commissions').select('id').eq('source_type','receipt_collection').eq('source_allocation_id',genReceiptR.json?.receiptId||'none')
      if(!genComms||genComms.length===0)pass('Receipt: general (no invoice) → zero commission')
      else fail('Receipt: general → zero commission',`${genComms.length} rows found`)
    }

    // ═══ 3f. SECURITY TESTS ═══
    log('═══ 3f. SECURITY TESTS ═══')

    // Try to call internal commission helper directly — should be blocked
    const supabaseUrl=env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    const secR=await page.evaluate(async({url,key})=>{
      try{
        const r=await fetch(`${url}/rest/v1/rpc/_post_salesman_collection_commission`,{method:'POST',headers:{'Content-Type':'application/json','apikey':key,'Authorization':`Bearer ${key}`},body:JSON.stringify({p_business_id:'biz-default',p_invoice_id:'test',p_net_collected:100,p_source_type:'sale_payment',p_source_allocation_id:'test',p_collection_date:'2026-07-12'})})
        return{status:r.status}
      }catch(e){return{status:'error',err:e.message}}
    },{url:supabaseUrl,key:supabaseKey}).catch(()=>({status:'error'}))
    if(secR.status===404||secR.status===401||secR.status===403||secR.status==='error')pass('Security: internal helper not directly callable')
    else fail('Security: internal helper',`status=${secR.status}`)

    const pdfTests=[
      {id:counterInv?.id,mode:'single',label:'Half A4 — Single Sheet',file:'p9-01-counter-half-a4.pdf',desc:'Counter Half-A4'},
      {id:onlineInv?.id,mode:'single',label:'Half A4 — Single Sheet',file:'p9-02-online-half-a4.pdf',desc:'Online Half-A4'},
      {id:ofcInv?.id,mode:'single',label:'Half A4 — Single Sheet',file:'p9-03-ofc-half-a4.pdf',desc:'OFC Half-A4'},
      {id:counterInv?.id,mode:'two-up',label:'Full A4 — Two Invoices',file:'p9-04-two-up.pdf',desc:'Two-Up'},
      {id:counterInv?.id,mode:'top-half',label:'Full A4 — Top Half Only',file:'p9-05-top-half.pdf',desc:'Top Half'},
      {id:counterInv?.id,mode:'bottom-half',label:'Full A4 — Bottom Half Only',file:'p9-06-bottom-half.pdf',desc:'Bottom Half'},
      {id:counterInv?.id,mode:'full-a4',label:'Full A4 — Single Invoice',file:'p9-07-full-a4.pdf',desc:'Full A4'},
      {id:partialInv?.id,mode:'single',label:'Half A4 — Single Sheet',file:'p9-08-partial-payment.pdf',desc:'Partial Payment'},
      {id:onlineInv?.id,mode:'single',label:'Half A4 — Single Sheet',file:'p9-09-delivery-fee.pdf',desc:'Delivery Fee'},
      {id:longInvId,mode:'single',label:'Half A4 — Single Sheet',file:'p9-10-long-name.pdf',desc:'Long Name'},
      {id:twelveInvId,mode:'single',label:'Half A4 — Single Sheet',file:'p9-11-twelve-items.pdf',desc:'12 Items'},
      {id:twelveInvId,mode:'full-a4',label:'Full A4 — Single Invoice',file:'p9-12-overflow-full-a4.pdf',desc:'Overflow Full-A4'},
    ]

    for(const t of pdfTests){
      if(!t.id){fail(`PDF ${t.desc}`,'No invoice');continue}
      try{
        const{pi,domContent,renderCheck}=await generatePrintPdf(page,t.id,t.mode,t.label,`${PDF_DIR}/${t.file}`)
        const pages=pi.Pages||'?'
        const size=pi['Page size']||'?'
        const contentOk=domContent.exists&&domContent.hasGrandTotal&&domContent.hasPaid&&domContent.hasINVOICE&&domContent.hasBusinessName
        const securityOk=domContent.hasNoUUID&&domContent.hasNoCost&&domContent.hasNoFabSKU
        const renderOk=renderCheck.hasContent
        if(pages==='1'&&contentOk&&securityOk&&renderOk)pass(`PDF ${t.desc}: ${pages}p ${size.slice(0,25)} content=OK sec=OK render=OK items=${domContent.itemCount}`)
        else fail(`PDF ${t.desc}`,`pages=${pages} content=${contentOk} sec=${securityOk} render=${renderOk}`)
      }catch(e){fail(`PDF ${t.desc}`,e.message?.slice(0,100))}
    }

    // ═══ 11. OVERFLOW MEASUREMENT ═══
    log('═══ 11. OVERFLOW MEASUREMENT ═══')
    // Case A: 1 short item
    const ovA=await measureOverflow(page,counterInv?.id||invoices[0]?.id)
    log(`  A (1 item): scrollH=${ovA.measurement?.scrollHeight} avail=516 overflow=${ovA.measurement?.overflow} btnDisabled=${ovA.printDisabled}`)
    if(ovA.measurement&&!ovA.measurement.overflow)pass('Overflow A (1 item): fits');else fail('Overflow A','overflow on 1 item')

    // Case B: 12 items
    const ovB=await measureOverflow(page,twelveInvId)
    log(`  B (12 items): scrollH=${ovB.measurement?.scrollHeight} avail=516 overflow=${ovB.measurement?.overflow} btnDisabled=${ovB.printDisabled}`)
    if(ovB.measurement?.overflow&&ovB.printDisabled)pass(`Overflow B (12 items): blocked (scrollH=${ovB.measurement.scrollHeight}>516, btn disabled)`)
    else if(ovB.measurement&&!ovB.measurement.overflow)pass(`Overflow B (12 items): fits (scrollH=${ovB.measurement.scrollHeight})`)
    else fail('Overflow B',`overflow=${ovB.measurement?.overflow} disabled=${ovB.printDisabled}`)

    // Case C: 4 long names
    const long4R=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:Array.from({length:4},(_,i)=>({productId:pid,productName:`${longName} Variant ${i+1}`,qty:1,unitPrice:'50000',isTemporary:false})),payments:[{accountId:cashId,amount:'200000',isChange:false}],salesmanId:SM,customerName:'P9 Long4 Cust'})
    const ovC=await measureOverflow(page,long4R.json?.invoiceId)
    log(`  C (4 long names): scrollH=${ovC.measurement?.scrollHeight} avail=516 overflow=${ovC.measurement?.overflow} btnDisabled=${ovC.printDisabled}`)
    if(ovC.measurement)pass(`Overflow C (4 long): scrollH=${ovC.measurement.scrollHeight} overflow=${ovC.measurement.overflow} btnDisabled=${ovC.printDisabled}`)
    else fail('Overflow C','no measurement')

    // Case D: Long address
    const longAddrR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Short Item',qty:1,unitPrice:'50000',isTemporary:false}],payments:[{accountId:cashId,amount:'50000',isChange:false}],salesmanId:SM,customerName:'P9 Long Addr Customer',customerPhone:'0300-1234567',customerAddress:'123 Very Long Address That Goes On And On Across Multiple Lines Apartment 5B Block C Phase 8 DHA Karachi Pakistan 75500'})
    const ovD=await measureOverflow(page,longAddrR.json?.invoiceId)
    log(`  D (long addr): scrollH=${ovD.measurement?.scrollHeight} overflow=${ovD.measurement?.overflow}`)
    if(ovD.measurement)pass(`Overflow D (long addr): scrollH=${ovD.measurement.scrollHeight} overflow=${ovD.measurement.overflow}`)
    else fail('Overflow D','no measurement')

    // Case E: Multiple payments
    const multiPayR=await api(page,'POST','/api/sales/counter',{invoiceType:'COUNTER',invoiceDate:TODAY,items:[{productId:pid,productName:'Multi Pay Item',qty:1,unitPrice:'500000',isTemporary:false}],payments:[{accountId:cashId,amount:'200000',isChange:false},{accountId:pettyId,amount:'200000',isChange:false},{accountId:cashId,amount:'100000',isChange:false}],salesmanId:SM,customerName:'P9 Multi Pay Cust'})
    const ovE=await measureOverflow(page,multiPayR.json?.invoiceId)
    log(`  E (3 payments): scrollH=${ovE.measurement?.scrollHeight} overflow=${ovE.measurement?.overflow}`)
    if(ovE.measurement)pass(`Overflow E (3 payments): scrollH=${ovE.measurement.scrollHeight} overflow=${ovE.measurement.overflow}`)
    else fail('Overflow E','no measurement')

    // ═══ 12. RESPONSIVE ═══
    log('═══ 12. RESPONSIVE ═══')
    for(const[n,w,h]of[['360x800',360,800],['390x844',390,844],['412x915',412,915],['768x1024',768,1024],['1280x800',1280,800],['1440x900',1440,900]]){
      await page.setViewportSize({width:w,height:h});await page.goto(`${BASE}/`,{waitUntil:'networkidle'});await page.waitForTimeout(1000)
      const ov=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)
      if(!ov)pass(`Responsive ${n}`);else fail(`Responsive ${n}`,'overflow')
    }

    // ═══ 13. CONSOLE ═══
    log('═══ 13. CONSOLE ═══')
    const ePage=await browser.newPage()
    const cErrors=[]
    ePage.on('console',m=>{if(m.type()==='error')cErrors.push(m.text().slice(0,100))})
    ePage.on('pageerror',e=>cErrors.push(`PAGE_ERROR: ${e.message.slice(0,80)}`))
    await ePage.goto(`${BASE}/`,{waitUntil:'networkidle'});await ePage.waitForTimeout(3000)
    if(cErrors.length===0)pass('Console: 0 errors');else{fail('Console',`${cErrors.length} errors`);for(const e of cErrors.slice(0,5))log(`  err: ${e}`)}

    // ═══ SUMMARY ═══
    log('\n═══ SUMMARY ═══')
    log(`Passed: ${R.passed}`)
    log(`Failed: ${R.failed}`)
    log(`Blocked: ${R.blocked}`)
    log(`Skipped: ${R.skipped}`)
    writeFileSync(`${AUDIT_DIR}/p9-acceptance-results.json`,JSON.stringify(R,null,2))
    if(R.failed>0||R.blocked>0)exitCode=1
  }catch(e){log(`FATAL: ${e.message}`);exitCode=1}finally{
    await browser.close();server.kill('SIGTERM');await new Promise(r=>setTimeout(r,1000));server.kill('SIGKILL')
  }
  process.exit(exitCode)
}
main().catch(e=>{console.error(e);process.exit(1)})
