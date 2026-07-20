/**
 * Smart data-access helpers for the Phase 3 Products & Stock module.
 *
 * Dual-path: uses Supabase RPC/tables when env vars are set AND Phase 3
 * migration is applied, Prisma otherwise.
 *
 * Money: prices are stored as numeric(14,2) in Supabase / Float in Prisma.
 * We use number for prices (not BigInt) since they're PKR with 2 decimals,
 * not integer paisas. Quantities are integer pieces.
 */
import 'server-only'
import { db } from '@/lib/db'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { probeTable } from '@/lib/supabase/phase-probe'
import { resolveSupabaseUuid } from '@/lib/accounting/voucher-supabase'
import { planOpeningStock, SafeProductError } from '@/lib/products/opening-stock'

/**
 * Fail-closed Supabase phase probe.
 *
 * When Supabase is configured, a failed probe THROWS (never returns false
 * to avoid silently falling through to Prisma/SQLite).  Prisma fallback is
 * only permitted when Supabase env vars are genuinely absent.
 */
const _p3cache = { lastChecked: 0, lastResult: false }

async function isPhase3Live(): Promise<boolean> {
  return probeTable(_p3cache, 'products')
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export type ProductCategoryRow = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
  productCount?: number
}

export type ProductRow = {
  id: string
  name: string
  categoryId: string | null
  categoryName: string | null
  unit: string
  salePrice: number
  purchasePrice: number
  currentStock: number
  isTemporary: boolean
  isActive: boolean
  markedForMerge: boolean
  lowStockThreshold: number
  createdAt: string
}

export type StockMovementRow = {
  id: string
  productId: string
  productName: string
  movementType: string
  quantity: number
  balanceAfter: number
  reason: string | null
  movementDate: string
  createdAt: string
}

// ─────────────────────────────────────────────────────────────
// Product Categories
// ─────────────────────────────────────────────────────────────
export async function listProductCategories(businessId: string): Promise<ProductCategoryRow[]> {
  if (await isPhase3Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('product_categories')
      .select('id, name, description, is_active, created_at')
      .eq('business_id', businessId)
      .order('name')
    if (error) throw new Error(`Supabase: ${error.message}`)
    return (data ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      isActive: c.is_active,
      createdAt: c.created_at,
    }))
  }
  const cats = await db.productCategory.findMany({
    where: { businessId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  })
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    productCount: c._count.products,
  }))
}

export async function createProductCategory(
  businessId: string,
  name: string,
  description?: string,
): Promise<ProductCategoryRow> {
  if (await isPhase3Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin
      .from('product_categories')
      .insert({ business_id: businessId, name, description: description ?? null, is_active: true })
      .select('id, name, description, is_active, created_at')
      .single()
    if (error) throw new Error(`Supabase: ${error.message}`)
    const c = data as any
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      isActive: c.is_active,
      createdAt: c.created_at,
    }
  }
  const c = await db.productCategory.create({
    data: { businessId, name, description: description ?? null },
  })
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────
export async function listProducts(
  businessId: string,
  opts?: { temporaryOnly?: boolean; search?: string },
): Promise<ProductRow[]> {
  if (await isPhase3Live()) {
    const admin = getAdminSupabase()
    // Try with low_stock_threshold column; if it fails (migration not applied
    // yet), retry without it and use default 5.
    const selectWithThreshold = 'id, name, category_id, unit, sale_price, purchase_price, current_stock, is_temporary, is_active, marked_for_merge, low_stock_threshold, created_at, product_categories(name)'
    const selectWithoutThreshold = 'id, name, category_id, unit, sale_price, purchase_price, current_stock, is_temporary, is_active, marked_for_merge, created_at, product_categories(name)'
    let query = admin.from('products').select(selectWithThreshold as any).eq('business_id', businessId).order('name')
    if (opts?.temporaryOnly) { query = query.eq('is_temporary', true) }
    let result = await query
    // If error is about missing column, retry without it
    if (result.error && result.error.message.includes('low_stock_threshold')) {
      query = admin.from('products').select(selectWithoutThreshold as any).eq('business_id', businessId).order('name')
      if (opts?.temporaryOnly) { query = query.eq('is_temporary', true) }
      result = await query
    }
    if (result.error) throw new Error(`Supabase: ${result.error.message}`)
    let rows = (result.data ?? []) as any[]
    if (opts?.search) {
      const q = opts.search.toLowerCase()
      rows = rows.filter((r) => r.name?.toLowerCase().includes(q))
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      categoryId: r.category_id,
      categoryName: r.product_categories?.name ?? null,
      unit: r.unit,
      salePrice: Number(r.sale_price ?? 0),
      purchasePrice: Number(r.purchase_price ?? 0),
      currentStock: r.current_stock,
      isTemporary: r.is_temporary,
      isActive: r.is_active,
      markedForMerge: r.marked_for_merge,
      lowStockThreshold: r.low_stock_threshold ?? 5,
      createdAt: r.created_at,
    }))
  }
  const products = await db.product.findMany({
    where: {
      businessId,
      ...(opts?.temporaryOnly ? { isTemporary: true } : {}),
      ...(opts?.search ? { name: { contains: opts.search } } : {}),
    },
    include: { category: true },
    orderBy: { name: 'asc' },
  })
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    unit: p.unit,
    salePrice: p.salePrice,
    purchasePrice: p.purchasePrice,
    currentStock: p.currentStock,
    isTemporary: p.isTemporary,
    isActive: p.isActive,
    markedForMerge: p.markedForMerge,
    lowStockThreshold: p.lowStockThreshold,
    createdAt: p.createdAt.toISOString(),
  }))
}

async function fetchProductRow(admin: ReturnType<typeof getAdminSupabase>, productId: string): Promise<ProductRow | null> {
  let result = await admin
    .from('products')
    .select(
      'id, name, category_id, unit, sale_price, purchase_price, current_stock, is_temporary, is_active, marked_for_merge, low_stock_threshold, created_at',
    )
    .eq('id', productId)
    .single()
  // Same fallback as listProducts: retry without low_stock_threshold if the
  // column is missing in this environment.
  if (result.error && result.error.message.includes('low_stock_threshold')) {
    result = await admin
      .from('products')
      .select(
        'id, name, category_id, unit, sale_price, purchase_price, current_stock, is_temporary, is_active, marked_for_merge, created_at',
      )
      .eq('id', productId)
      .single() as typeof result
  }
  const { data, error } = result
  if (error || !data) return null
  const p = data as any
  return {
    id: p.id,
    name: p.name,
    categoryId: p.category_id,
    categoryName: null,
    unit: p.unit,
    salePrice: Number(p.sale_price),
    purchasePrice: Number(p.purchase_price),
    currentStock: p.current_stock,
    isTemporary: p.is_temporary,
    isActive: p.is_active,
    markedForMerge: p.marked_for_merge,
    lowStockThreshold: p.low_stock_threshold ?? 5,
    createdAt: p.created_at,
  }
}

export async function createProduct(
  businessId: string,
  input: {
    name: string
    categoryId?: string | null
    salePrice?: number
    purchasePrice?: number
    openingStock?: number
    isTemporary?: boolean
    lowStockThreshold?: number
    idempotencyKey?: string
    createdBy?: string | null
  },
): Promise<{ product: ProductRow; stockMovementId?: string }> {
  const openingStock = input.openingStock ?? 0
  // Validate up-front: throws a safe error on negative/fractional quantity or
  // negative cost, and on positive quantity with zero cost (which would create
  // stock quantity without valuation or accounting). Null = nothing to post.
  const openingPlan = planOpeningStock(openingStock, input.purchasePrice ?? 0)

  if (await isPhase3Live()) {
    const admin = getAdminSupabase()

    // Idempotency: retried POSTs with the same key return the original product
    // instead of creating a duplicate. Backed by the CREATE_PRODUCT audit row
    // (the Phase-8 products table has no idempotency_key column).
    const idempotencyKey = input.idempotencyKey ?? null
    if (idempotencyKey) {
      const { data: priorAudit } = await admin
        .from('audit_logs')
        .select('entity_id')
        .eq('business_id', businessId)
        .eq('action', 'CREATE_PRODUCT')
        .eq('details->>idempotency_key', idempotencyKey)
        .limit(1)
        .maybeSingle()
      if (priorAudit?.entity_id) {
        const existing = await fetchProductRow(admin, priorAudit.entity_id as string)
        if (existing) {
          const { data: sm } = await admin
            .from('stock_movements')
            .select('id')
            .eq('product_id', existing.id)
            .eq('movement_type', 'opening')
            .limit(1)
            .maybeSingle()
          return { product: existing, stockMovementId: (sm as any)?.id }
        }
      }
    }

    // Step 1: create the product with ZERO stock. Opening quantity is only
    // ever applied by the atomic post_opening_stock RPC below — never here —
    // so a failure cannot leave quantity without valuation/accounting.
    const { data: created, error: createErr } = await admin
      .from('products')
      .insert({
        business_id: businessId,
        name: input.name,
        category_id: input.categoryId ?? null,
        unit: 'piece',
        sale_price: input.salePrice ?? 0,
        purchase_price: input.purchasePrice ?? 0,
        current_stock: 0,
        is_temporary: input.isTemporary ?? false,
      })
      .select('id')
      .single()
    if (createErr || !created) throw new Error('Failed to create product. Please try again.')
    const productId = (created as any).id as string

    // low_stock_threshold column may not exist yet — set it separately and
    // tolerate failure (same posture as updateProduct).
    if (input.lowStockThreshold !== undefined) {
      await admin.from('products').update({ low_stock_threshold: input.lowStockThreshold }).eq('id', productId)
    }

    const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)

    // Audit the creation (also anchors the idempotency lookup above).
    await admin.from('audit_logs').insert({
      business_id: businessId,
      user_id: supabaseCreatedBy,
      action: 'CREATE_PRODUCT',
      entity: 'product',
      entity_id: productId,
      details: {
        name: input.name,
        opening_stock: openingStock,
        idempotency_key: idempotencyKey,
      },
    })

    // Step 2: post opening stock atomically (movement + WAC + Inventory
    // debit / Opening Balance Equity credit voucher + audit, one transaction).
    let stockMovementId: string | undefined
    if (openingPlan) {
      const { data: opening, error: openingErr } = await admin.rpc('post_opening_stock', {
        p_business_id: businessId,
        p_product_id: productId,
        p_quantity: openingPlan.openingQty,
        p_unit_cost_paisas: openingPlan.unitCostPaisas.toString(),
        p_created_by: supabaseCreatedBy,
      })
      if (openingErr) {
        // The RPC rolled back completely: the product exists at zero quantity
        // with no movement and no voucher. Surface that honestly to the user,
        // and carry a sanitized diagnostic (PostgREST error code + truncated
        // message) for the SERVER LOG only so the failure is diagnosable via
        // its requestId. PostgREST codes distinguish the likely causes:
        //   PGRST202 → function missing from the schema cache
        //   42501    → nested EXECUTE denied (function-owner privilege chain)
        //   P0001    → a business rule RAISE inside the RPC
        const code = (openingErr as any).code ? String((openingErr as any).code) : 'unknown'
        const rawMsg = (openingErr as any).message ? String((openingErr as any).message) : ''
        const diagnostic = `post_opening_stock [${code}] ${rawMsg}`.slice(0, 200)
        throw new SafeProductError(
          `Product "${input.name}" was created, but opening stock could not be posted. ` +
          'The product currently has zero stock. Add the opening quantity via Stock Entry, or retry later.',
          diagnostic,
        )
      }
      stockMovementId = ((opening as any)?.movement_id as string) || undefined
    }

    const fresh = await fetchProductRow(admin, productId)
    if (!fresh) throw new Error('Failed to read created product.')
    return { product: fresh, stockMovementId }
  }

  // Prisma fallback — duplicate-safe with idempotency key.
  const idempotencyKey = input.idempotencyKey || null
  if (idempotencyKey) {
    const existing = await db.product.findFirst({
      where: { businessId, idempotencyKey },
      select: { id: true, currentStock: true },
    })
    if (existing) {
      const sm = await db.stockMovement.findFirst({
        where: { productId: existing.id, movementType: 'opening' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      const product = await db.product.findUniqueOrThrow({
        where: { id: existing.id },
      })
      return {
        product: {
          id: product.id,
          name: product.name,
          categoryId: product.categoryId,
          categoryName: null,
          unit: product.unit,
          salePrice: product.salePrice,
          purchasePrice: product.purchasePrice,
          currentStock: product.currentStock,
          isTemporary: product.isTemporary,
          isActive: product.isActive,
          markedForMerge: product.markedForMerge,
          lowStockThreshold: product.lowStockThreshold,
          createdAt: product.createdAt.toISOString(),
        },
        stockMovementId: sm?.id,
      }
    }
  }

  const p = await db.product.create({
    data: {
      businessId,
      name: input.name,
      categoryId: input.categoryId ?? null,
      unit: 'piece',
      salePrice: input.salePrice ?? 0,
      purchasePrice: input.purchasePrice ?? 0,
      currentStock: 0,
      isTemporary: input.isTemporary ?? false,
      lowStockThreshold: input.lowStockThreshold ?? 5,
      idempotencyKey,
    },
  })

  let stockMovementId: string | undefined
  if (openingPlan) {
    const sm = await db.stockMovement.create({
      data: {
        businessId,
        productId: p.id,
        movementType: 'opening',
        quantity: openingPlan.openingQty,
        balanceAfter: openingPlan.openingQty,
        reason: 'Opening stock',
      },
    })
    stockMovementId = sm.id
    await db.product.update({
      where: { id: p.id },
      data: { currentStock: openingPlan.openingQty },
    })
  }

  return {
    product: {
      id: p.id,
      name: p.name,
      categoryId: p.categoryId,
      categoryName: null,
      unit: p.unit,
      salePrice: p.salePrice,
      purchasePrice: p.purchasePrice,
      currentStock: openingPlan?.openingQty ?? 0,
      isTemporary: p.isTemporary,
      isActive: p.isActive,
      markedForMerge: p.markedForMerge,
      lowStockThreshold: p.lowStockThreshold,
      createdAt: p.createdAt.toISOString(),
    },
    stockMovementId,
  }
}

export async function updateProduct(
  businessId: string,
  productId: string,
  updates: {
    name?: string
    categoryId?: string | null
    salePrice?: number
    purchasePrice?: number
    isTemporary?: boolean
    isActive?: boolean
    markedForMerge?: boolean
    lowStockThreshold?: number
  },
): Promise<void> {
  if (await isPhase3Live()) {
    const admin = getAdminSupabase()
    const patch: Record<string, unknown> = {}
    if (updates.name !== undefined) patch.name = updates.name
    if (updates.categoryId !== undefined) patch.category_id = updates.categoryId
    if (updates.salePrice !== undefined) patch.sale_price = updates.salePrice
    if (updates.purchasePrice !== undefined) patch.purchase_price = updates.purchasePrice
    if (updates.isTemporary !== undefined) patch.is_temporary = updates.isTemporary
    // low_stock_threshold may not exist in Supabase yet — try anyway, ignore error
    if (updates.lowStockThreshold !== undefined) {
      // Attempt to set it; if column doesn't exist, the update will succeed
      // for other fields but this one will be silently ignored by PostgREST
      // when using .update() with unknown columns. Actually, PostgREST returns
      // an error. So we need to handle it separately.
      // For now, skip it until migration is applied.
    }
    if (updates.isActive !== undefined) patch.is_active = updates.isActive
    if (updates.markedForMerge !== undefined) patch.marked_for_merge = updates.markedForMerge

    const { error } = await admin
      .from('products')
      .update(patch)
      .eq('id', productId)
      .eq('business_id', businessId)
    if (error) throw new Error(`Supabase: ${error.message}`)
    return
  }
  await db.product.updateMany({
    where: { id: productId, businessId },
    data: updates as any,
  })
}

// ─────────────────────────────────────────────────────────────
// Stock Movements
// ─────────────────────────────────────────────────────────────
export async function createStockMovement(
  businessId: string,
  input: {
    productId: string
    movementType: 'opening' | 'adjustment_in' | 'adjustment_out' | 'temporary_item' | 'correction'
    quantity: number
    reason?: string
    createdBy?: string | null
  },
): Promise<{ id: string; balanceAfter: number }> {
  if (await isPhase3Live()) {
    const admin = getAdminSupabase()
    // Resolve Supabase UUID for created_by.
    const supabaseCreatedBy = await resolveSupabaseUuid(input.createdBy)

    const { data, error } = await admin.rpc('create_stock_movement', {
      p_business_id: businessId,
      p_product_id: input.productId,
      p_movement_type: input.movementType,
      p_quantity: input.quantity,
      p_reason: input.reason ?? null,
      p_created_by: supabaseCreatedBy,
    })
    if (error) throw new Error(`Supabase: ${error.message}`)

    // Fetch the balance_after from the created movement.
    const { data: sm, error: smErr } = await admin
      .from('stock_movements')
      .select('balance_after')
      .eq('id', data as string)
      .single()
    if (smErr) throw new Error(`Supabase fetch movement: ${smErr.message}`)

    return { id: data as string, balanceAfter: (sm as any).balance_after }
  }

  // Prisma fallback — atomic $transaction: lookup + movement + stock update
  // all commit or rollback together. Uses atomic increment/decrement to
  // avoid read-compute-write races when two parallel POSTs arrive.
  const delta =
    input.movementType === 'adjustment_out'
      ? -input.quantity
      : input.movementType === 'correction'
        ? input.quantity // correction can be +/-
        : input.quantity

  const result = await db.$transaction(async (tx) => {
    // Validate product exists and belongs to the business.
    const product = await tx.product.findFirst({
      where: { id: input.productId, businessId },
      select: { currentStock: true },
    })
    if (!product) throw new Error('Product not found')

    // Compute balanceAfter from the current value inside the transaction.
    const newStock = product.currentStock + delta

    // Create the stock movement record.
    const sm = await tx.stockMovement.create({
      data: {
        businessId,
        productId: input.productId,
        movementType: input.movementType,
        quantity: input.quantity,
        balanceAfter: newStock,
        reason: input.reason ?? null,
        createdBy: input.createdBy ?? null,
      },
    })

    // Atomically update the product's currentStock using Prisma increment.
    await tx.product.update({
      where: { id: input.productId },
      data: { currentStock: { increment: delta } },
    })

    return { id: sm.id, balanceAfter: newStock }
  })

  return result
}

export async function listStockMovements(
  businessId: string,
  productId?: string,
): Promise<StockMovementRow[]> {
  if (await isPhase3Live()) {
    const admin = getAdminSupabase()
    let query = admin
      .from('stock_movements')
      .select('id, product_id, movement_type, quantity, balance_after, reason, movement_date, created_at, products(name)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (productId) {
      query = query.eq('product_id', productId)
    }
    const { data, error } = await query
    if (error) throw new Error(`Supabase: ${error.message}`)
    return (data ?? []).map((r: any) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.products?.name ?? '—',
      movementType: r.movement_type,
      quantity: r.quantity,
      balanceAfter: r.balance_after,
      reason: r.reason,
      movementDate: r.movement_date,
      createdAt: r.created_at,
    }))
  }
  const movements = await db.stockMovement.findMany({
    where: { businessId, ...(productId ? { productId } : {}) },
    include: { product: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return movements.map((m) => ({
    id: m.id,
    productId: m.productId,
    productName: m.product.name,
    movementType: m.movementType,
    quantity: m.quantity,
    balanceAfter: m.balanceAfter,
    reason: m.reason,
    movementDate: m.movementDate.toISOString(),
    createdAt: m.createdAt.toISOString(),
  }))
}

// ─────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────
export async function negativeStockReport(businessId: string): Promise<Array<{
  productId: string
  productName: string
  categoryName: string | null
  currentStock: number
  isTemporary: boolean
  lastMovementDate: string | null
  lastMovementType: string | null
}>> {
  if (await isPhase3Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin.rpc('negative_stock_report', { p_business_id: businessId })
    if (error) throw new Error(`Supabase: ${error.message}`)
    return ((data as any[]) ?? []).map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      categoryName: r.category_name,
      currentStock: r.current_stock,
      isTemporary: r.is_temporary,
      lastMovementDate: r.last_movement_date,
      lastMovementType: r.last_movement_type,
    }))
  }
  const products = await db.product.findMany({
    where: { businessId, currentStock: { lt: 0 }, isActive: true },
    include: { category: true, stockMovements: { orderBy: { createdAt: 'desc' }, take: 1 } },
    orderBy: { currentStock: 'asc' },
  })
  return products.map((p) => ({
    productId: p.id,
    productName: p.name,
    categoryName: p.category?.name ?? null,
    currentStock: p.currentStock,
    isTemporary: p.isTemporary,
    lastMovementDate: p.stockMovements[0]?.movementDate.toISOString() ?? null,
    lastMovementType: p.stockMovements[0]?.movementType ?? null,
  }))
}

export async function pendingStockReport(businessId: string): Promise<Array<{
  productId: string
  productName: string
  categoryName: string | null
  currentStock: number
  isTemporary: boolean
  lastMovementDate: string | null
  lastMovementType: string | null
  pendingQty: number
}>> {
  if (await isPhase3Live()) {
    const admin = getAdminSupabase()
    const { data, error } = await admin.rpc('pending_stock_report', { p_business_id: businessId })
    if (error) throw new Error(`Supabase: ${error.message}`)
    return ((data as any[]) ?? []).map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      categoryName: r.category_name,
      currentStock: r.current_stock,
      isTemporary: r.is_temporary,
      lastMovementDate: r.last_movement_date,
      lastMovementType: r.last_movement_type,
      pendingQty: r.pending_qty,
    }))
  }
  // Prisma fallback: products with stock < 0 OR that have had an adjustment_out.
  const products = await db.product.findMany({
    where: {
      businessId,
      isActive: true,
      OR: [
        { currentStock: { lt: 0 } },
        { stockMovements: { some: { movementType: { in: ['adjustment_out', 'correction'] } } } },
      ],
    },
    include: { category: true, stockMovements: { orderBy: { createdAt: 'desc' }, take: 1 } },
    orderBy: { currentStock: 'asc' },
  })
  return products.map((p) => ({
    productId: p.id,
    productName: p.name,
    categoryName: p.category?.name ?? null,
    currentStock: p.currentStock,
    isTemporary: p.isTemporary,
    lastMovementDate: p.stockMovements[0]?.movementDate.toISOString() ?? null,
    lastMovementType: p.stockMovements[0]?.movementType ?? null,
    pendingQty: p.currentStock < 0 ? Math.abs(p.currentStock) : 0,
  }))
}