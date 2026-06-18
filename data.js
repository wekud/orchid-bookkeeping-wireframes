const OrchidBookkeeping = (() => {
  const STORAGE_KEY = "orchid_bookkeeping_store_v1";
  const GRADE_ORDER = ["special", "a", "b", "c"];
  const GRADE_LABELS = {
    special: "特级",
    a: "A级",
    b: "B级",
    c: "C级"
  };
  const DEFAULT_STORE = {
    salesRecords: [],
    expenseRecords: [],
    workers: [],
    workerRecords: [],
    workerSettlements: []
  };

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readStore() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULT_STORE);
    try {
      const parsed = JSON.parse(raw);
      return {
        salesRecords: Array.isArray(parsed.salesRecords) ? parsed.salesRecords : [],
        expenseRecords: Array.isArray(parsed.expenseRecords) ? parsed.expenseRecords : [],
        workers: Array.isArray(parsed.workers) ? parsed.workers : [],
        workerRecords: Array.isArray(parsed.workerRecords) ? parsed.workerRecords : [],
        workerSettlements: Array.isArray(parsed.workerSettlements) ? parsed.workerSettlements : []
      };
    } catch (error) {
      return clone(DEFAULT_STORE);
    }
  }

  function writeStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  function normalizeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function toDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatCurrency(value) {
    return `¥ ${normalizeNumber(value).toFixed(0)}`;
  }

  function formatCurrencyPrecise(value) {
    return `¥ ${normalizeNumber(value).toFixed(2).replace(/\.00$/, "")}`;
  }

  function buildSaleRecord(payload) {
    const gradeItems = GRADE_ORDER.map((gradeKey) => {
      const source = payload.gradeItems?.[gradeKey] || {};
      const price = normalizeNumber(source.price);
      const quantity = normalizeNumber(source.quantity);
      const amount = price * quantity;
      return {
        gradeKey,
        gradeLabel: GRADE_LABELS[gradeKey],
        price,
        quantity,
        note: source.note || "",
        amount
      };
    });

    return {
      id: createId("sale"),
      date: payload.date,
      customer: payload.customer || "",
      saleMethod: payload.saleMethod || "",
      paymentStatus: payload.paymentStatus || "",
      createdAt: new Date().toISOString(),
      totalQuantity: gradeItems.reduce((sum, item) => sum + item.quantity, 0),
      totalAmount: gradeItems.reduce((sum, item) => sum + item.amount, 0),
      gradeItems
    };
  }

  function buildExpenseRecord(payload) {
    return {
      id: createId("expense"),
      date: payload.date,
      expenseType: payload.expenseType || "",
      amount: normalizeNumber(payload.amount),
      paymentMethod: payload.paymentMethod || "",
      note: payload.note || "",
      createdAt: new Date().toISOString()
    };
  }

  function saveSaleRecord(payload) {
    const store = readStore();
    const record = buildSaleRecord(payload);
    store.salesRecords.unshift(record);
    writeStore(store);
    return record;
  }

  function saveExpenseRecord(payload) {
    const store = readStore();
    const record = buildExpenseRecord(payload);
    store.expenseRecords.unshift(record);
    writeStore(store);
    return record;
  }

  function deleteSaleRecord(id) {
    const store = readStore();
    store.salesRecords = store.salesRecords.filter((item) => item.id !== id);
    writeStore(store);
  }

  function deleteExpenseRecord(id) {
    const store = readStore();
    store.expenseRecords = store.expenseRecords.filter((item) => item.id !== id);
    writeStore(store);
  }

  function getSalesRecords() {
    return readStore().salesRecords;
  }

  function getExpenseRecords() {
    return readStore().expenseRecords;
  }

  function getTodaySummary(referenceDate = new Date()) {
    const dayKey = toDateKey(referenceDate);
    const sales = getSalesRecords().filter((item) => toDateKey(item.date) === dayKey);
    const dayStart = startOfDay(referenceDate);
    const expenses = [
      ...getExpenseRecords().filter((item) => toDateKey(item.date) === dayKey),
      ...buildWorkerExpenseSummaries(dayStart, dayStart)
    ];
    return buildSummaryFromLists(sales, expenses);
  }

  function getLatestRecords(limit = 3) {
    const sales = getSalesRecords().map((item) => ({
      type: "sale",
      title: `${item.customer || "客户"} 销售`,
      amount: item.totalAmount,
      time: item.createdAt,
      description: `${toDateKey(item.date)} · ${item.totalQuantity} 株 · ${item.paymentStatus || "未标记"}`
    }));
    const expenses = getExpenseRecords().map((item) => ({
      type: "expense",
      title: item.expenseType || "支出",
      amount: item.amount,
      time: item.createdAt,
      description: `${toDateKey(item.date)} · ${item.paymentMethod || "未标记"}`
    }));
    return [...sales, ...expenses]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, limit);
  }

  function buildSummaryFromLists(sales, expenses) {
    const salesTotal = sales.reduce((sum, item) => sum + normalizeNumber(item.totalAmount), 0);
    const expenseTotal = expenses.reduce((sum, item) => sum + normalizeNumber(item.amount), 0);
    return {
      salesTotal,
      expenseTotal,
      profitTotal: salesTotal - expenseTotal,
      salesCount: sales.length,
      expenseCount: expenses.length
    };
  }

  function buildWorkerExpenseSummaries(start, end) {
    const workerMap = new Map(getWorkers().map((worker) => [worker.id, worker]));
    const grouped = {};

    getWorkerRecords().forEach((record) => {
      if (!isDateInRange(record.date, start, end)) return;
      const worker = workerMap.get(record.workerId);
      if (!worker) return;
      const dateKey = toDateKey(record.date);
      const groupKey = `${record.workerId}_${dateKey}`;
      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          id: groupKey,
          date: dateKey,
          expenseType: "????",
          amount: 0,
          paymentMethod: "???",
          note: `${worker.name} ????`,
          createdAt: record.createdAt
        };
      }
      grouped[groupKey].amount += record.isHalfDay
        ? normalizeNumber(worker.dailyWage) * 0.5
        : normalizeNumber(worker.dailyWage);
    });

    return Object.values(grouped);
  }

  function getRangeSummary(mode, anchorDate = new Date()) {
    const sales = getSalesRecords();
    const range = resolveRange(mode, anchorDate);
    const filteredSales = sales.filter((item) => isDateInRange(item.date, range.start, range.end));
    const filteredExpenses = [
      ...getExpenseRecords().filter((item) => isDateInRange(item.date, range.start, range.end)),
      ...buildWorkerExpenseSummaries(range.start, range.end)
    ];
    return {
      mode,
      label: range.label,
      start: range.start,
      end: range.end,
      ...buildSummaryFromLists(filteredSales, filteredExpenses),
      sales: filteredSales,
      expenses: filteredExpenses
    };
  }

  function isDateInRange(value, start, end) {
    const target = startOfDay(value).getTime();
    return target >= start.getTime() && target <= end.getTime();
  }

  function resolveRange(mode, anchorDate) {
    const target = startOfDay(anchorDate);
    if (mode === "day") {
      return {
        start: target,
        end: target,
        label: toDateKey(target)
      };
    }

    if (mode === "week") {
      const day = target.getDay() || 7;
      const start = new Date(target);
      start.setDate(target.getDate() - day + 1);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return {
        start,
        end,
        label: `${toDateKey(start)} 至 ${toDateKey(end)}`
      };
    }

    const start = new Date(target.getFullYear(), target.getMonth(), 1);
    const end = new Date(target.getFullYear(), target.getMonth() + 1, 0);
    return {
      start,
      end,
      label: `${target.getFullYear()}-${`${target.getMonth() + 1}`.padStart(2, "0")}`
    };
  }

  function getExpenseBreakdown(mode, anchorDate = new Date()) {
    const summary = getRangeSummary(mode, anchorDate);
    const grouped = {};
    summary.expenses.forEach((item) => {
      const key = item.expenseType || "其他支出";
      grouped[key] = (grouped[key] || 0) + normalizeNumber(item.amount);
    });
    return Object.entries(grouped)
      .map(([label, amount]) => ({
        label,
        amount,
        percent: summary.expenseTotal ? Math.round((amount / summary.expenseTotal) * 100) : 0
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  function getSalesGradeBreakdown(referenceDate = new Date()) {
    const todayKey = toDateKey(referenceDate);
    const buckets = GRADE_ORDER.map((key) => ({
      gradeKey: key,
      gradeLabel: GRADE_LABELS[key],
      amount: 0
    }));
    getSalesRecords()
      .filter((record) => toDateKey(record.date) === todayKey)
      .forEach((record) => {
        record.gradeItems.forEach((item) => {
          const bucket = buckets.find((entry) => entry.gradeKey === item.gradeKey);
          if (bucket) bucket.amount += normalizeNumber(item.amount);
        });
      });
    const total = buckets.reduce((sum, item) => sum + item.amount, 0);
    return buckets.map((item) => ({
      ...item,
      percent: total ? Math.round((item.amount / total) * 100) : 0
    }));
  }

  // ========== 工人管理 ==========

  function getWorkers() {
    return readStore().workers;
  }

  function saveWorker(payload) {
    const store = readStore();
    if (payload.id) {
      // 更新
      const index = store.workers.findIndex((w) => w.id === payload.id);
      if (index !== -1) {
        store.workers[index].name = payload.name || store.workers[index].name;
        store.workers[index].dailyWage = normalizeNumber(payload.dailyWage);
      }
    } else {
      // 新增
      store.workers.push({
        id: createId("worker"),
        name: payload.name || "",
        dailyWage: normalizeNumber(payload.dailyWage),
        createdAt: new Date().toISOString()
      });
    }
    writeStore(store);
  }

  function deleteWorker(id) {
    const store = readStore();
    store.workers = store.workers.filter((w) => w.id !== id);
    store.workerRecords = store.workerRecords.filter((r) => r.workerId !== id);
    store.workerSettlements = store.workerSettlements.filter((s) => s.workerId !== id);
    writeStore(store);
  }

  function getWorkerRecords(workerId) {
    const records = readStore().workerRecords;
    if (workerId) return records.filter((r) => r.workerId === workerId);
    return records;
  }

  function saveWorkerRecord(payload) {
    const store = readStore();
    const record = {
      id: createId("wr"),
      workerId: payload.workerId,
      date: payload.date || toDateKey(new Date()),
      isHalfDay: !!payload.isHalfDay,
      note: payload.note || "",
      createdAt: new Date().toISOString()
    };
    store.workerRecords.unshift(record);
    writeStore(store);
    return record;
  }

  function deleteWorkerRecord(id) {
    const store = readStore();
    store.workerRecords = store.workerRecords.filter((r) => r.id !== id);
    writeStore(store);
  }

  // ========== 工人结算 ==========

  function getWorkerSettlements(workerId) {
    const settlements = readStore().workerSettlements;
    if (workerId) return settlements.filter((s) => s.workerId === workerId);
    return settlements;
  }

  function saveWorkerSettlement(payload) {
    const store = readStore();
    const record = {
      id: createId("ws"),
      workerId: payload.workerId,
      date: payload.date || toDateKey(new Date()),
      amount: normalizeNumber(payload.amount),
      note: payload.note || "",
      createdAt: new Date().toISOString()
    };
    store.workerSettlements.unshift(record);
    writeStore(store);
    return record;
  }

  function deleteWorkerSettlement(id) {
    const store = readStore();
    store.workerSettlements = store.workerSettlements.filter((s) => s.id !== id);
    writeStore(store);
  }

  function getWorkerSummary() {
    const workers = getWorkers();
    const records = getWorkerRecords();
    const settlements = getWorkerSettlements();
    return workers.map((worker) => {
      const workerRecords = records.filter((r) => r.workerId === worker.id);
      const workerSettlements = settlements.filter((s) => s.workerId === worker.id);
      const fullDays = workerRecords.filter((r) => !r.isHalfDay).length;
      const halfDays = workerRecords.filter((r) => r.isHalfDay).length;
      const totalDays = fullDays + halfDays * 0.5;
      const totalWage = totalDays * worker.dailyWage;
      const settledAmount = workerSettlements.reduce((sum, s) => sum + s.amount, 0);
      return {
        ...worker,
        fullDays,
        halfDays,
        totalDays,
        totalWage,
        settledAmount,
        unsettledAmount: totalWage - settledAmount,
        records: workerRecords,
        settlements: workerSettlements
      };
    });
  }

  function exportStore() {
    return JSON.stringify(readStore(), null, 2);
  }

  function importStore(text) {
    const parsed = JSON.parse(text);
    const nextStore = {
      salesRecords: Array.isArray(parsed.salesRecords) ? parsed.salesRecords : [],
      expenseRecords: Array.isArray(parsed.expenseRecords) ? parsed.expenseRecords : [],
      workers: Array.isArray(parsed.workers) ? parsed.workers : [],
      workerRecords: Array.isArray(parsed.workerRecords) ? parsed.workerRecords : [],
      workerSettlements: Array.isArray(parsed.workerSettlements) ? parsed.workerSettlements : []
    };
    writeStore(nextStore);
    return nextStore;
  }

  function seedDemoData() {
    const store = readStore();
    if (store.salesRecords.length || store.expenseRecords.length) return;

    const demoSales = buildSaleRecord({
      date: toDateKey(new Date()),
      customer: "老周花卉店",
      saleMethod: "批发销售",
      paymentStatus: "已收款",
      gradeItems: {
        special: { price: 120, quantity: 10, note: "花形整齐，主打精品。" },
        a: { price: 95, quantity: 8, note: "日常稳定销售。" },
        b: { price: 70, quantity: 6, note: "与 A 级搭配出售。" },
        c: { price: 40, quantity: 12, note: "清仓组合优惠。" }
      }
    });

    const demoExpenses = [
      buildExpenseRecord({
        date: toDateKey(new Date()),
        expenseType: "工人开销",
        amount: 500,
        paymentMethod: "现金",
        note: "浇水、搬运工资，2 名工人半天。"
      }),
      buildExpenseRecord({
        date: toDateKey(new Date()),
        expenseType: "材料采购",
        amount: 300,
        paymentMethod: "微信",
        note: "花盆、肥料补货。"
      }),
      buildExpenseRecord({
        date: toDateKey(new Date()),
        expenseType: "幼苗采购",
        amount: 180,
        paymentMethod: "现金",
        note: "补货 80 株。"
      })
    ];

    writeStore({
      salesRecords: [demoSales],
      expenseRecords: demoExpenses
    });
  }

  return {
    GRADE_ORDER,
    GRADE_LABELS,
    formatCurrency,
    formatCurrencyPrecise,
    toDateKey,
    saveSaleRecord,
    saveExpenseRecord,
    deleteSaleRecord,
    deleteExpenseRecord,
    getSalesRecords,
    getExpenseRecords,
    getTodaySummary,
    getLatestRecords,
    getRangeSummary,
    getExpenseBreakdown,
    getSalesGradeBreakdown,
    exportStore,
    importStore,
    seedDemoData,
    getWorkers,
    saveWorker,
    deleteWorker,
    getWorkerRecords,
    saveWorkerRecord,
    deleteWorkerRecord,
    getWorkerSummary,
    getWorkerSettlements,
    saveWorkerSettlement,
    deleteWorkerSettlement
  };
})();
