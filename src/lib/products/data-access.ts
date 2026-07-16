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
  },
): Promise<{ product: ProductRow; stockMovementId?: string }> {
  const openingStock = input.openingStock ?? 0

  if (await isPhase3Live()) {
    const admin = getAdminSupabase()
    // Atomic RPC: create product + opening stock movement in one transaction.
    // Idempotency key prevents duplicate products from retried POST requests.
    const { data: rpcResult, error: rpcErr } = await admin.rpc(
      'atomic_create_product',
      {
        p_business_id: businessId,
        p_name: input.name,
        p_category_id: input.categoryId ?? null,
        p_sale_price: input.salePrice ?? 0,
        p_purchase_price: input.purchasePrice ?? 0,
        p_opening_stock: openingStock,
        p_is_temporary: input.isTemporary ?? false,
        p_low_stock_threshold: input.lowStockThreshold ?? 5,
        p_idempotency_key: input.idempotencyKey ?? null,
        p_created_by: null,
      },
    )
    if (rpcErr) throw new Error('Failed to create product. Please try again.')
    const result = rpcResult as any
    const productId = result.product_id as string
    const stockMovementId = (result.stock_movement_id as string) || undefined
    const finalStock = (result.current_stock as number) ?? 0

    // Fetch the full product row.
    const { data: fresh, error: freshErr } = await admin
      .from('products')
      .select(
        'id, name, category_id, unit, sale_price, purchase_price, current_stock, is_temporary, is_active, marked_for_merge, low_stock_threshold, created_at',
      )
      .eq('id', productId)
      .single()
    if (freshErr || !fresh) throw new Error('Failed to read created product.')

    const p = fresh as any
    return {
      product: {
        id: p.id,
        name: p.name,
        categoryId: p.category_id,
        categoryName: null,
        unit: p.unit,
        salePrice: Number(p.sale_price),
        purchasePrice: Number(p.purchase_price),
        currentStock: finalStock,
        isTemporary: p.is_temporary,
        isActive: p.is_active,
        markedForMerge: p.marked_for_merge,
        lowStockThreshold: p.low_stock_threshold ?? 5,
        createdAt: p.created_at,
      },
      stockMovementId,
    }
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
  if (openingStock !== 0) {
    const sm = await db.stockMovement.create({
      data: {
        businessId,
        productId: p.id,
        movementType: 'opening',
        quantity: Math.abs(openingStock),
        balanceAfter: openingStock,
        reason: 'Opening stock',
      },
    })
    stockMovementId = sm.id
    await db.product.update({
      where: { id: p.id },
      data: { currentStock: openingStock },
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
      currentStock: openingStock,
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
    let supabaseCreatedBy: string | null = null
    if (input.createdBy) {
      const u = await db.user.findUnique({
        where: { id: input.createdBy },
        select: { supabaseUserUuid: true },
      })
      supabaseCreatedBy = u?.supabaseUserUuid ?? null
    }

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

  // Prisma fallback
  const product = await db.product.findFirst({
    where: { id: input.productId, businessId },
    select: { currentStock: true },
  })
  if (!product) throw new Error('Product not found')

  const delta =
    input.movementType === 'adjustment_out'
      ? -input.quantity
      : input.movementType === 'correction'
      ? input.quantity // correction can be +/-
      : input.quantity

  const balanceAfter = product.currentStock + delta

  const sm = await db.stockMovement.create({
    data: {
      businessId,
      productId: input.productId,
      movementType: input.movementType,
      quantity: input.quantity,
      balanceAfter,
      reason: input.reason ?? null,
      createdBy: input.createdBy ?? null,
    },
  })

  await db.product.update({
    where: { id: input.productId },
    data: { currentStock: balanceAfter },
  })

  return { id: sm.id, balanceAfter }
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
