"use strict";

// todo: track line/char number, improve error messaging/stack trace
// todo: better JS api (e.g. exporting of methods)
// todo: Infinity & NaN
// todo: in worker threads, import should only add to import object
// todo: indirect function type (not partial)
// todo: use SIMD for faster string/array comparison?
// todo: move all instantiation to start_func instead of dumping memory to file?
// todo: check for temporary instances in functions that need to be freed
// todo: ensure all array operations check bounds
// todo: check if safe_add_i32 should be used more
// todo: track highest address used
// todo: check if should be using more atomic ops
// todo: make field_setters thread safe?
// todo: each intermediate value in code must be named & freed
// todo: gensym/namespace syntax quoted symbol
// todo: replace (i32$const ...func_idx_leb128) with (i32$const ...leb128(func_idx)) [i32$const expects signed]
// todo: review values created here (e.g. make_string()) and consolidate/free
// todo: using varuint/varsint in all the right places?
// todo: should String have an array or just a memory block?
// todo: handle String/File encodings other than UTF8
// todo: keep track of tail position, optimize tail calls?
// todo: emit number literal directly
// todo: turn local refs back on after func call

(function init (module_sections, memory_content) {
  const is_browser = this === this.window;
  if (is_browser) {
  
  } else {
    const workers = require('node:worker_threads');
    function new_worker (pkg) {
      return new workers.Worker(pkg, { eval: true });
    }
    if (workers.isMainThread) {
      build_comp(new_worker, init, {
        is_browser: false,
        is_main: true
      }, module_sections, memory_content);
    } else {
      workers.parentPort.on("message", function (env) {
        build_comp(new_worker, init, env, module_sections);
      });
    }
  }
}).call(this);

function build_comp (new_worker, init, main_env, module_sections, memory_content) {

console.time("all");

/*------*\
|        |
| leb128 |
|        |
\*------*/

function uleb128 (num) {
  num = BigInt(num);
  const out = [];
  while (true) {
    const byte_ = Number(num & 0x7fn);
    num >>= 7n;
    if (!num) {
      out.push(byte_);
      return out;
    }
    out.push(byte_ | 0x80);
  }
}

function leb128 (num) {
  const size = num instanceof BigInt ? 64 : 32;
  num = BigInt.asIntN(size, BigInt(num));
  const out = [];
  while (true) {
    const byte_ = Number(num & 0x7fn);
    num = num >>= 7n;
    if (
      (num === 0n && (byte_ & 0x40) === 0) ||
      (num === -1n && (byte_ & 0x40) !== 0)
    ) {
      out.push(byte_);
      return out;
    }
    out.push(byte_ | 0x80);
  }
}

/*--------*\
|          |
| op codes |
|          |
\*--------*/

const wasm = {
  "unreachable":		0x00,
  "nop":			0x01,
  "block":			0x02,
  "loop":			0x03,
  "if":				0x04,
  "else":			0x05,
  "try":			0x06,
  "catch":			0x07,
  "throw":			0x08,
  "rethrow":			0x09,
  "end":			0x0b,
  "br":				0x0c,
  "br_if":			0x0d,
  "br_table":			0x0e,
  "return":			0x0f,
  "call":			0x10,
  "call_indirect":		0x11,
  "drop":			0x1a,
  "select":			0x1b,
  "select_t":			0x1c,
  "delegate":			0x18,
  "catch_all":			0x19,
  "local$get":			0x20,
  "local$set":			0x21,
  "local$tee":			0x22,
  "global$get":			0x23,
  "global$set":			0x24,
  "table$get":			0x25,
  "table$set":			0x26,
  "i32$load":			0x28,
  "i64$load":			0x29,
  "f32$load":			0x2a,
  "f64$load":			0x2b,
  "i32$load8_s":		0x2c,
  "i32$load8_u":		0x2d,
  "i32$load16_s":		0x2e,
  "i32$load16_u":		0x2f,
  "i64$load8_s": 		0x30,
  "i64$load8_u": 		0x31,
  "i64$load16_s":		0x32,
  "i64$load16_u":		0x33,
  "i64$load32_s":		0x34,
  "i64$load32_u":		0x35,
  "i32$store":			0x36,
  "i64$store":			0x37,
  "f32$store":			0x38,
  "f64$store":			0x39,
  "i32$store8":			0x3a,
  "i32$store16":		0x3b,
  "i64$store8":			0x3c,
  "i64$store16":		0x3d,
  "i64$store32":		0x3e,
  "memory$size":		0x3f,
  "memory$grow":		0x40,
  "i32$const":			0x41,
  "i64$const":			0x42,
  "f32$const":			0x43,
  "f64$const":			0x44,
  "i32$eqz":			0x45,
  "i32$eq":			0x46,
  "i32$ne":			0x47,
  "i32$lt_s":			0x48,
  "i32$lt_u":			0x49,
  "i32$gt_s":			0x4a,
  "i32$gt_u":			0x4b,
  "i32$le_s":			0x4c,
  "i32$le_u":			0x4d,
  "i32$ge_s":			0x4e,
  "i32$ge_u":			0x4f,
  "i64$eqz":			0x50,
  "i64$eq":			0x51,
  "i64$ne":			0x52,
  "i64$lt_s":			0x53,
  "i64$lt_u":			0x54,
  "i64$gt_s":			0x55,
  "i64$gt_u":			0x56,
  "i64$le_s":			0x57,
  "i64$le_u":			0x58,
  "i64$ge_s":			0x59,
  "i64$ge_u":			0x5a,
  "f32$eq":			0x5b,
  "f32$ne":			0x5c,
  "f32$lt":			0x5d,
  "f32$gt":			0x5e,
  "f32$le":			0x5f,
  "f32$ge":			0x60,
  "f64$eq":			0x61,
  "f64$ne":			0x62,
  "f64$lt":			0x63,
  "f64$gt":			0x64,
  "f64$le":			0x65,
  "f64$ge":			0x66,
  "i32$clz":			0x67,
  "i32$ctz":			0x68,
  "i32$popcnt":			0x69,
  "i32$add":			0x6a,
  "i32$sub":			0x6b,
  "i32$mul":			0x6c,
  "i32$div_s":			0x6d,
  "i32$div_u":			0x6e,
  "i32$rem_s":			0x6f,
  "i32$rem_u":			0x70,
  "i32$and":			0x71,
  "i32$or":			0x72,
  "i32$xor":			0x73,
  "i32$shl":			0x74,
  "i32$shr_s":			0x75,
  "i32$shr_u":			0x76,
  "i32$rotl":			0x77,
  "i32$rotr":			0x78,
  "i64$clz":			0x79,
  "i64$ctz":			0x7a,
  "i64$popcnt":			0x7b,
  "i64$add":			0x7c,
  "i64$sub":			0x7d,
  "i64$mul":			0x7e,
  "i64$div_s":			0x7f,
  "i64$div_u":			0x80,
  "i64$rem_s":			0x81,
  "i64$rem_u":			0x82,
  "i64$and":			0x83,
  "i64$or":			0x84,
  "i64$xor":			0x85,
  "i64$shl":			0x86,
  "i64$shr_s":			0x87,
  "i64$shr_u":			0x88,
  "i64$rotl":			0x89,
  "i64$rotr":			0x8a,
  "f32$abs":			0x8b,
  "f32$neg":			0x8c,
  "f32$ceil":			0x8d,
  "f32$floor":			0x8e,
  "f32$trunc":			0x8f,
  "f32$nearest":		0x90,
  "f32$sqrt":			0x91,
  "f32$add":			0x92,
  "f32$sub":			0x93,
  "f32$mul":			0x94,
  "f32$div":			0x95,
  "f32$min":			0x96,
  "f32$max":			0x97,
  "f32$copysign":		0x98,
  "f64$abs":			0x99,
  "f64$neg":			0x9a,
  "f64$ceil":			0x9b,
  "f64$floor":			0x9c,
  "f64$trunc":			0x9d,
  "f64$nearest":		0x9e,
  "f64$sqrt":			0x9f,
  "f64$add":			0xa0,
  "f64$sub":			0xa1,
  "f64$mul":			0xa2,
  "f64$div":			0xa3,
  "f64$min":			0xa4,
  "f64$max":			0xa5,
  "f64$copysign":		0xa6,
  "i32$wrap_i64":		0xa7,
  "i32$trunc_f32_s":		0xa8,
  "i32$trunc_f32_u":		0xa9,
  "i32$trunc_f64_s":		0xaa,
  "i32$trunc_f64_u":		0xab,
  "i64$extend_i32_s":		0xac,
  "i64$extend_i32_u":		0xad,
  "i64$trunc_f32_s":		0xae,
  "i64$trunc_f32_u":		0xaf,
  "i64$trunc_f64_s":		0xb0,
  "i64$trunc_f64_u":		0xb1,
  "f32$convert_i32_s":		0xb2,
  "f32$convert_i32_u":		0xb3,
  "f32$convert_i64_s":		0xb4,
  "f32$convert_i64_u":		0xb5,
  "f32$demote_f64":		0xb6,
  "f64$convert_i32_s":		0xb7,
  "f64$convert_i32_u":		0xb8,
  "f64$convert_i64_s":		0xb9,
  "f64$convert_i64_u":		0xba,
  "f64$promote_f32":		0xbb,
  "i32$reinterpret_f32":	0xbc,
  "i64$reinterpret_f64":	0xbd,
  "f32$reinterpret_i32":	0xbe,
  "f64$reinterpret_i64":	0xbf,
  "i32$extend8_s":		0xc0,
  "i32$extend16_s":		0xc1,
  "i64$extend8_s":		0xc2,
  "i64$extend16_s":		0xc3,
  "i64$extend32_s":		0xc4,
  "ref$null":			0xd0,
  "ref$is_null":		0xd1,
  "ref$func":			0xd2,
  "mem$prefix":			0xfc,
  "mem$copy":			0x0a,
  "mem$fill":			0x0b,
  "atomic$prefix":		0xfe,
  "memory$atomic$notify":	0x00,
  "memory$atomic$wait32":	0x01,
  "i32$atomic$load":		0x10,
  "i64$atomic$load":		0x11,
  "i32$atomic$load8_u":		0x12,
  "i64$atomic$load8_u":		0x14,
  "i32$atomic$store":		0x17,
  "i64$atomic$store":		0x18,
  "i32$atomic$store8":		0x19,
  "i64$atomic$store8":		0x1B,
  "i32$atomic$rmw$add":		0x1e,
  "i64$atomic$rmw$add":		0x1f,
  "i32$atomic$rmw$sub":		0x25,
  "i32$atomic$rmw$and":		0x2c,
  "i32$atomic$rmw$xchg":	0x41,
  "i32$atomic$rmw$cmpxchg":	0x48,
  void:				0x40,
  func:				0x60,
  funcref:			0x70,
  f64:				0x7c,
  f32:				0x7d,
  i64:				0x7e,
  i32:				0x7f
};

/*--------------*\
|                |
| wasm interface |
|                |
\*--------------*/

const encode = ((t) => t.encode.bind(t))(new TextEncoder),
      decode = ((t) => t.decode.bind(t))(new TextDecoder);

function wasm_encode_string (str) {
  const encoded = encode(str);
  return [encoded.length, ...encoded];
}

// in a child thread memory will be provided through main_env
// in a compiled file, memory_content will be provided to init() in source code
const memory = main_env.memory || (function (cont) {
  const initial = Math.ceil(cont.length * 4 / 65536) || 1;
  const mem = new WebAssembly.Memory({
    initial: initial,
    maximum: 65536,
    shared: true
  });
  new Uint32Array(mem.buffer).set(cont);
  return mem;
})(memory_content || []);

const [
  type_section,
  func_import_section,
  memory_import_section,
  tag_import_section,
  func_section,
  table_section,
  tag_section,
  export_section,
  elem_section,
  code_section
// in a compiled file, module_sections will be provided to init() in source code
] = module_sections ||= [
  [[wasm.func, 2, wasm.i32, wasm.i32, 0]],
  [],
  [[
    ...wasm_encode_string("imports"),
    ...wasm_encode_string("memory"),
    2, 3, 1, ...uleb128(65536)
  ]],
  [
    [
      ...wasm_encode_string("imports"),
      ...wasm_encode_string("exception_tag"),
      4, 0, 0
    ]
  ],
  [],
  [[wasm.funcref, 0, 0]],
  [[0, 0]],
  [],
  [],
  []
];

const exception_enum = [],
      def_exception = (nm) => {
        exception_enum.push(nm);
        return exception_enum.length - 1;
      },
      // exception type and arbitrary data
      exception_tag = new WebAssembly.Tag({ parameters: ["i32", "i32"] }),
      imports = { memory: memory, exception_tag };

/*--------------*\
|                |
| wasm interface |
|                |
\*--------------*/

function _get_type_idx (spec) {
  const spec_sig = [
    wasm.func,
    ...uleb128(spec.params.length),
    ...spec.params,
    ...uleb128(spec.result.length),
    ...spec.result
  ];
  for (let i = 0; i < type_section.length; i++) {
    const sig = type_section[i];
    if (sig.length !== spec_sig.length) continue;
    let j;
    for (j = 0; j < sig.length; j++) {
      if (sig[j] !== spec_sig[j]) break;
    }
    if (j === sig.length) return i;
  }
  const type_idx = type_section.length;
  type_section.push(spec_sig);
  return type_idx;
}

// increment import_num instead of counting func_import_section because
// in compiled files, func_import_section will already be filled out
let import_num = 0, func_num = 0;

function reserve_func_num (spec) {
  spec.func_idx = func_num++;
  spec.func_idx_leb128 = uleb128(spec.func_idx);
}

function func_wrapper (spec, cb) {
  spec.type_idx = _get_type_idx(spec);
  if (!spec.func_idx_leb128) reserve_func_num(spec);
  cb();
  return spec;
}

const funcs = [];

function func (spec) {
  return func_wrapper(spec, function () {
    const func_num = spec.func_idx - import_num;
    func_section[func_num] = [spec.type_idx];
    if (spec.export) {
      export_section.push([
        ...wasm_encode_string(spec.export), 0,
        ...spec.func_idx_leb128
      ]);
    }
    const locals = [0];
    let curr_type;
    for (const t of spec.locals) {
      if (t === curr_type) {
        locals[locals.length - 2]++;
      } else {
        locals.push(1, t);
        locals[0]++;
        curr_type = t;
      }
    }
    funcs.push(function () {
      spec.code.unshift(...locals);
      spec.code.push(wasm.end);
      code_section[func_num] = [...uleb128(spec.code.length), ...spec.code];
    });
  });
}

function import_func ({
  i32_params = 0,
  i64_params = 0,
  f64_params = 0,
  i32_results = 0,
  i64_results = 0,
  f64_results = 0
}, func) {
  const spec = { params: [], result: [] };
  for (let i = 0; i < i32_params; i++) spec.params.push(wasm.i32);
  for (let i = 0; i < i64_params; i++) spec.params.push(wasm.i64);
  for (let i = 0; i < f64_params; i++) spec.params.push(wasm.f64);
  for (let i = 0; i < i32_results; i++) spec.result.push(wasm.i32);
  for (let i = 0; i < i64_results; i++) spec.result.push(wasm.i64);
  for (let i = 0; i < f64_results; i++) spec.result.push(wasm.f64);
  func_wrapper(spec, function () {
    import_num++;
    const import_name = `func_import_${import_num}`;
    imports[import_name] = func;
    // in compiled file, func_import_section will be provided,
    // so length will be greater than import_num
    if (func_import_section.length < import_num) {
      func_import_section.push([
        ...wasm_encode_string("imports"),
        ...wasm_encode_string(import_name),
        0, spec.type_idx
      ]);
    }
  });
  return Object.assign(func, spec);
}

const get_type_idx = import_func(
  {i32_params: 4, i32_results: 1},
  function (
    i32_params,
    i64_params,
    f64_params,
    result_type
  ) {
    const params = [];
    for (let i = 0; i < i32_params; i++) params.push(wasm.i32);
    for (let i = 0; i < i64_params; i++) params.push(wasm.i64);
    for (let i = 0; i < f64_params; i++) params.push(wasm.f64);
    const result = result_type ? [result_type] : [];
    return _get_type_idx({ params, result });
  }
);

let next_addr;

function func_builder (cb) {
  let local_num = 0;
  const spec = {
	  params: [],
          locals: [],
          code: [],
          result: []
        },
        local_adder = function (coll) {
          return function (t) {
            coll.push(t);
            return uleb128(local_num++);
          };
        };
  reserve_func_num(spec);
  // allows defining function and building later
  spec.build = function (cb) {
    cb({
      param: local_adder(spec.params),
      local: local_adder(spec.locals),
      func_idx_leb128: spec.func_idx_leb128,
      append_code: (...ops) => spec.code.push(...ops),
      prepend_code: (...ops) => spec.code.unshift(...ops),
      add_result: (...types) => {
        for (const t of types) if (t) spec.result.push(t);
      },
      set_export: (xp) => spec.export = xp
    });
    return func(spec);
  }
  if (cb) return spec.build(cb);
  return spec;
}

/*---------*\
|           |
| ref table |
|           |
\*---------*/

const ref_table = [null, false, true];

let next_ref_address = -1;

const store_ref = import_func(
  {i32_params: 1, i32_results: 1},
  function (obj) {
    let nra = next_ref_address;
    if (nra === -1) {
      nra = ref_table.length;
    } else {
      next_ref_address = ref_table[nra];
    }
    ref_table[nra] = obj;
    return nra;
  }
);

function load_ref (idx) {
  return ref_table[idx];
}

const free_ref = import_func(
  {i32_params: 1, i32_results: 0},
  function (idx) {
    ref_table[idx] = next_ref_address;
    next_ref_address = idx;
  }
);

/*----------*\
|            |
| open funcs |
|            |
\*----------*/

const open_funcs = [null];

let next_func_idx = 0;

const start_func = import_func(
  {i32_params: 0, i32_results: 1},
  function () {
    const curr_func = {
      params: [],
      result: [],
      locals: [],
      code: []
    };
    let idx = next_func_idx;
    if (idx === 0) {
      idx = open_funcs.length;
    } else {
      next_func_idx = open_funcs[idx];
    }
    open_funcs[idx] = curr_func;
    return idx;
  }
);

const end_func = import_func(
  {i32_params: 1, i32_results: 1},
  function (idx) {
    const out = func(open_funcs[idx]);
    open_funcs[idx] = next_func_idx;
    next_func_idx = idx;
    return out.func_idx;
  }
);

const set_export = import_func(
  {i32_params: 2, i32_results: 1},
  function (fidx, xpt) {
    open_funcs[fidx].export = load_ref(xpt);
    free_ref(xpt);
    return fidx;
  }
);

function push_code (coll) {
  return import_func(
    {i32_params: 2, i32_results: 1},
    function (fidx, code) {
      if (code) open_funcs[fidx][coll].push(code);
      return fidx;
    }
  );
}

const add_param = push_code("params"),
      add_local = push_code("locals"),
      add_result = push_code("result"),
      append_code = push_code("code");

const prepend_code = import_func(
  {i32_params: 2, i32_results: 1},
  function (fidx, code) {
    open_funcs[fidx].code.unshift(code);
    return fidx;
  }
);

function add_varint32 (append, signed) {
  return import_func(
    {i32_params: 2, i32_results: 1},
    function (fidx, num) {
      num = signed ? leb128(num) : uleb128(num);
      const code = open_funcs[fidx].code;
      code[append ? "push" : "unshift"](...num);
      return fidx;
    }
  );
}

const append_varsint64 = import_func(
  {i32_params: 1, i64_params: 1, i32_results: 1},
  function (fidx, num) {
    const code = open_funcs[fidx].code;
// todo: is uleb right here? doesn't work w/ leb128
    code.push(...uleb128(num));
    return fidx;
  }
);

const prepend_varuint32 = add_varint32(false, false),
      append_varuint32 = add_varint32(true, false),
      prepend_varsint32 = add_varint32(false, true),
      append_varsint32 = add_varint32(true, true);

const get_op_code = import_func(
  {i32_params: 2, i32_results: 1},
  function (namespace, name) {
    namespace = load_ref(namespace);
    let op_name = load_ref(name);
    if (namespace) op_name = namespace + "$" + op_name;
    return wasm[op_name];
  }
);

/*----------*\
|            |
| start func |
|            |
\*----------*/

const start_funcs = [];

let start_func_index = -1

function complete_start_func () {
  const start_section = [];
  let sfi;
  if (start_func_index !== -1) {
    sfi = end_func(start_func_index);
    start_funcs.push(sfi);
    sfi = uleb128(sfi);
    start_section.push(8, ...uleb128(sfi.length), ...sfi);
    start_func_index = -1;
  }
  return start_section;
}

const add_to_start_func = import_func(
  { i32_params: 1 },
  function (cb) {
    let fidx;
    if (typeof cb === "function") {
      fidx = func_builder(cb);
      start_funcs.push(fidx.func_idx);
      fidx = fidx.func_idx_leb128;
    } else {
      start_funcs.push(cb);
      fidx = uleb128(cb);
    }
    if (start_func_index === -1) start_func_index = start_func();
    open_funcs[start_func_index].code.push(wasm.call);
    open_funcs[start_func_index].code.push(...fidx);
    return fidx;
  }
);

/*-------*\
|         |
| compile |
|         |
\*-------*/

let comp;

function flatten_table_section () {
  const out = [];
  for (const [type, flags, size] of table_section) {
    out.push(type, flags, ...uleb128(size));
  }
  return out;
}

const compile = import_func({},
  function () {
    const start_section = complete_start_func();
    while (funcs.length) funcs.shift()();
    const import_section = [
            ...memory_import_section,
            ...tag_import_section,
            ...func_import_section
          ],
          ts = [...uleb128(type_section.length),   ...type_section.flat()],
          is = [...uleb128(import_section.length), ...import_section.flat()],
          fs = [...uleb128(func_section.length),   ...func_section.flat()],
          bs = [...uleb128(table_section.length),  ...flatten_table_section()],
          as = [...uleb128(tag_section.length),    ...tag_section.flat()],
          es = [...uleb128(export_section.length), ...export_section.flat()],
          ls = [...uleb128(elem_section.length),   ...elem_section.flat()],
          cs = [...uleb128(code_section.length),   ...code_section.flat()],
          module_code = [
            0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
            1,  ...uleb128(ts.length), ...ts,
            2,  ...uleb128(is.length), ...is,
            3,  ...uleb128(fs.length), ...fs,
            4,  ...uleb128(bs.length), ...bs,
            13, ...uleb128(as.length), ...as,
            7,  ...uleb128(es.length), ...es,
            ...start_section,
            9,  ...uleb128(ls.length), ...ls,
            10, ...uleb128(cs.length), ...cs
          ],
          buf = Uint8Array.from(module_code),
          mod = new WebAssembly.Module(buf),
          inst = new WebAssembly.Instance(mod, { imports });
    while (start_funcs.length) {
      code_section[start_funcs.pop() - import_num] = [2, 0, 0xb];
    }
    comp = inst.exports;
  }
);

/*------*\
|        |
| method |
|        |
\*------*/

const func_table = import_func(
  {i32_results: 1},
  function () {
    const table_idx = table_section.length;
    table_section.push([wasm.funcref, 0, 0]);
    return table_idx;
  }
);

const impl_method = import_func(
  {i32_params: 3},
  function (mtd_num, type_num, func_num) {
    const mtd_table = table_section[mtd_num];
    if (mtd_table[2] <= type_num) mtd_table[2] = type_num + 1;
    elem_section.push([
      2, ...uleb128(mtd_num),
      wasm.i32$const, ...leb128(type_num), wasm.end, 
      0, 1, ...uleb128(func_num)
    ]);
  }
);

// export comp func for use with call_indirect
const add_to_func_table = import_func(
  {i32_params: 1, i32_results: 1},
  function (func_num) {
    const idx = table_section[0][2];
    impl_method(0, idx, func_num);
    return idx;
  }
);

/*----------*\
|            |
| js interop |
|            |
\*----------*/

const js_eq = import_func(
  {i32_params: 2, i32_results: 1},
  function (a, b) {
    return (load_ref(a) === load_ref(b)) ? 1 : 0;
  }
);

const js_add = import_func(
  {i32_params: 2, i32_results: 1},
  function (a, b) {
    return store_ref(load_ref(a) + load_ref(b));
  }
);

const js_get = import_func(
  {i32_params: 2, i32_results: 1},
  function (obj, prop) {
    obj = load_ref(obj);
    prop = load_ref(prop);
    const out = obj[prop];
    return comp.Object(store_ref(out));
  }
);

const js_call_0 = import_func(
  {i32_params: 2, i32_results: 1},
  function (obj, mtd) {
    obj = load_ref(obj);
    mtd = load_ref(mtd);
    const out = obj[mtd]();
    return comp.Object(store_ref(out));
  }
);

const js_call_1 = import_func(
  { i32_params: 3, i32_results: 1 },
  function (obj, mtd, arg) {
    obj = load_ref(obj);
    mtd = load_ref(mtd);
    arg = load_ref(arg);
    const out = obj[mtd](arg);
    return comp.Object(store_ref(out));
  }
);

const print_val = import_func(
  { i32_params: 1, i32_results: 1 },
  function (obj) {
    console.log(
      obj,
      memview.getUint32(obj, true)
    );
    return obj;
  }
);

const print_obj = import_func(
  { i32_params: 1 },
  function (ref) { console.log(load_ref(ref)); }
);

function sym_to_js (which, addr) {
  const ns = comp[`${which}$namespace`](addr);
  return store_ref({
    type: which,
    namespace: ns ? comp_string_to_js(ns) : null,
    name: comp_string_to_js(comp[`${which}$name`](addr))
  });
}

const to_js = import_func(
  {i32_params: 1, i32_results: 1},
  function (addr) {
    if (comp.Nil$instance(addr)) {
      return 0;
    } else if (comp.False$instance(addr)) {
      return 1;
    } else if (comp.True$instance(addr)) {
      return 2;
    } else if (comp.Int$instance(addr)) {
      return store_ref(comp.Int$value(addr));
    } else if (comp.Float$instance(addr)) {
      return store_ref(comp.Float$value(addr));
    } else if (comp.String$instance(addr)) {
      return store_ref(comp_string_to_js(addr));
    } else if (comp.Keyword$instance(addr)) {
      return sym_to_js("Keyword", addr);
    } else if (comp.Symbol$instance(addr)) {
      return sym_to_js("Symbol", addr);
    } else if (comp.VectorSeq$instance(addr)) {
      return vector_seq_to_js(addr);
    } else if (comp.Vector$instance(addr)) {
      return vector_to_js(addr);
    }
  }
);

function vector_to_js (addr) {
  const out = [];
  for (let i = 0; i < comp.Vector$count(addr); i++) {
    const val = to_js(comp.nth(addr, i, nil));
    out.push(load_ref(val));
  }
  return store_ref(out);
}

function vector_seq_to_js (addr) {
  const out = [];
  while (comp.VectorSeq$count(addr)) {
    const val = to_js(comp.first(addr));
    out.push(load_ref(val));
    addr = comp.rest(addr);
  }
  return store_ref(out);
}

const new_atom = import_func(
  {i32_params: 1, i32_results: 1},
  function (val) {
    const atom = comp.Atom(val, 0);
    comp.inc_refs(val);
    return atom;
  }
);

function make_symkw (which) {
  return function (ns, nm) {
    if (arguments.length === 1) {
      nm = ns;
      ns = 0;
    }
    if (typeof ns === "string") ns = make_string(ns);
    if (typeof nm === "string") nm = make_string(nm);
    const out = comp[which](ns, nm);
    // comp.free(ns);
    // comp.free(nm);
    return out;
  }
}

const make_symbol = make_symkw("symbol");
const make_keyword = make_symkw("keyword");

/*-------*\
|         |
| package |
|         |
\*-------*/

function slice_source (str, which) {
  const directive_start = `\n// !!! ${which} cut\n`;
  let start_cut = str.indexOf(directive_start);
  while (start_cut > -1) {
    const cut = str.slice(start_cut + directive_start.length),
          aft_cut = cut.slice(cut.indexOf(directive_start) + directive_start.length + 1);
    str = str.slice(0, start_cut);
    str += aft_cut;
    start_cut = str.indexOf(directive_start);
  }
  return str;
}

function build_package () {
  let func_code = build_comp.toString();
  func_code = slice_source(func_code, "package");
  if (typeof minify !== "undefined") func_code = minify(func_code).code;
  let init_code = init.toString();
  if (typeof minify !== "undefined") init_code = minify(init_code).code;
  func_code += `(${init_code}).call(this,`;
  func_code += JSON.stringify(module_sections) + ",";
  const last_addr = Atomics.load(new Uint32Array(memory.buffer), next_addr / 4),
        mem_arr = Array.from(new Uint32Array(memory.buffer, 0, last_addr / 4));
  func_code += JSON.stringify(mem_arr) + ");";
  return func_code;
}

/*--------------*\
|                |
| string interop |
|                |
\*--------------*/

function comp_string_to_js (addr) {
  const len = comp.String$length(addr),
        arr = comp.String$arr(addr),
        bytes = new DataView(memory.buffer, comp.Array$arr(arr), len);
  return decode(bytes);
}

const strings = {}, string_refs = {};

const store_string = import_func(
  { i32_params: 1, i32_results: 1 },
  function (str) {
    const js_str = comp_string_to_js(str);
    if (string_refs[js_str]) return string_refs[js_str];
    strings[js_str] = str;
    return string_refs[js_str] = store_ref(js_str);
  }
);

function bytes_to_comp_string (bytes) {
  const len = bytes.byteLength,
        arrlen = Math.ceil(len / 4),
        arr = comp.array_by_length(arrlen);
  new Uint8Array(memory.buffer).set(bytes, comp.Array$arr(arr));
  return comp.String(arr, len);
}

function make_string (str) {
  if (!strings[str]) {
    strings[str] = bytes_to_comp_string(encode(str));
  }
  return strings[str];
}

const print_i32 = import_func({i32_params: 1}, (n) => console.log(n));
const print_i64 = import_func({i64_params: 1}, (n) => console.log(n));
const print_f64 = import_func({f64_params: 1}, (n) => console.log(n));

const print_char = import_func(
  { i32_params: 1 },
  function (chr) {
    console.log(String.fromCodePoint(chr));
  }
);

const print_plain_string = import_func(
  { i32_params: 1 },
  function (str) {
    console.log(comp_string_to_js(str));
  }
);

const print_string = import_func(
  { i32_params: 1 },
  function (str) {
    console.log(`"${comp_string_to_js(str)}"`);
  }
);

/*------------*\
|              |
| File interop |
|              |
\*------------*/

const file_close = import_func(
  { i32_params: 1 },
  function (fstr) {
    fs.closeSync(comp.File$fd(fstr));
  }
);

const file_length = import_func(
  { i32_params: 1, i32_results: 1 },
  function (fstr) {
    const fd = comp.File$fd(fstr);
    return fs.fstatSync(fd).size;
  }
);

const file_get_string_chunk = import_func(
  { i32_params: 3, i32_results: 1},
  function (fstr, start, len) {
    const arr = comp.array_by_length(Math.ceil(len / 4)),
          buf = new DataView(memory.buffer),
          fd = comp.File$fd(fstr),
          br = fs.readSync(fd, buf, comp.Array$arr(arr), len, start);
    return comp.String(arr, br);
  }
);

/*-------*\
|         |
| threads |
|         |
\*-------*/

// todo: review this section
let thread_port;

// todo: maintain thread pool
const start_thread = import_func(
  { i32_results: 1 },
  function () {
    if (!main_env.is_browser) {
      const thread_port = comp.alloc(8),
            sub_env = {
              memory: memory,
              is_browser: main_env.is_browser,
              thread_port: thread_port,
              is_main: false
            },
            pkg = get_cuts(build_package(), "thread"),
            worker = new_worker(pkg);
      // (new DataView(memory.buffer)).setUint32(thread_port + 4, 1, true);
      worker.postMessage(sub_env);
      // return thread_port;
    }
  }
);

const nil = 0,
      max_inst_size = 256;

// addresses 4 through max_inst_size are for freed memory blocks
let curr_addr = max_inst_size;

const comp_false = curr_addr += 4,
      comp_true = curr_addr += 4;

// !!! package cut

/*----*\
|      |
| COMP |
|      |
\*----*/

const memview = new DataView(memory.buffer);
memview.setUint32(comp_false, 1, true);
memview.setUint32(comp_false, 2, true);
// storage location of the next available addr for alloc
next_addr = curr_addr += 4;
const curr_page_start = curr_addr += 4;
memview.setUint32(next_addr, curr_addr += 4, true);

// todo: in comp, new_array must keep size below 2**31
const get_next_address = func_builder(function (func) {
  const size = func.param(wasm.i32),
        out = func.local(wasm.i32),
        curr_max = func.local(wasm.i32),
        curr_min = func.local(wasm.i32),
        new_addr = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    // atomically add the slot size to the stored next available address
    // to store the next address after that
    wasm.i32$const, ...leb128(next_addr),
    wasm.local$get, ...size,
    wasm.atomic$prefix,
    wasm.i32$atomic$rmw$add, 2, 0,
    wasm.local$tee, ...out,
    // the above returns the previous next address, so add the size again
    wasm.local$get, ...size,
    wasm.i32$add,
    wasm.local$tee, ...new_addr,
    wasm.i32$const, ...leb128(curr_page_start),
    wasm.atomic$prefix,
    wasm.i32$atomic$load, 2, 0,
    wasm.local$tee, ...curr_min,
    wasm.i32$gt_u,
    wasm.local$get, ...out,
    wasm.local$get, ...curr_min,
    wasm.i32$ge_u,
    wasm.i32$and,
    // both out and new_addr must be > page_start
    // if new_addr is less, then i32$add overflowed
    // if out is less, another thread may have overflowed
    // either way, return 1 to throw error, not proceed
    wasm.if, wasm.i32,
      wasm.local$get, ...new_addr,
      // load the current maximum possible address
      wasm.local$get, ...curr_min,
      wasm.i32$const, ...leb128(65535),
      wasm.i32$add,
      // if new_addr is greater than curr_page_end
      wasm.i32$gt_u,
      wasm.if, wasm.i32,
        // set curr_page_start to curr_page_start + 65536
        wasm.i32$const, ...leb128(curr_page_start),
        wasm.local$get, ...curr_min,
        wasm.local$get, ...curr_min,
        wasm.i32$const, ...leb128(65536),
        wasm.i32$add,
        wasm.atomic$prefix,
        wasm.i32$atomic$rmw$cmpxchg, 2, 0,
        // previous curr_page_start is returned
        // if not equal to curr_min, then another thread already grew memory
        wasm.local$get, ...curr_min,
        wasm.i32$eq,
        wasm.if, wasm.i32,
          // grow memory so next address is usable
          wasm.i32$const, 1,
          wasm.memory$grow, 0,
          // failure returns -1
          wasm.i32$const, ...leb128(-1),
          wasm.i32$eq,
        wasm.else,
          wasm.i32$const, 0,
        wasm.end,
      wasm.else,
        wasm.i32$const, 0,
      wasm.end,
    wasm.else,
      wasm.i32$const, 1,
    wasm.end,
    wasm.if, wasm.void,
      wasm.i32$const, def_exception("insufficient memory"),
      wasm.i32$const, 0,
      wasm.throw, 0,
    wasm.end,
    wasm.local$get, ...out
  );
});

const alloc = func_builder(function (func) {
  // size in bytes
  const type_size = func.param(wasm.i32),
        addr = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.set_export("alloc");
  func.append_code(
    // load previously freed address for type and set as addr
    // type_size is also address where freed blocks are stored
    wasm.local$get, ...type_size,
    wasm.i32$const, 0,
    wasm.atomic$prefix,
    // replace address with zero so other threads will use get_next_address
    wasm.i32$atomic$rmw$and, 2, 0,
    wasm.local$tee, ...addr,
    // above returns value in type_addr
    wasm.if, wasm.i32,
      // store previous next type address as next type address
      // previous next type address was stored where some freed data was previously stored
      // this will result in a chain until we get back to 0
      wasm.local$get, ...type_size,
      wasm.local$get, ...addr,
      wasm.i32$load, 2, 0,
      wasm.atomic$prefix,
      wasm.i32$atomic$store, 2, 0,
      wasm.local$get, ...addr,
      wasm.i32$const, 0,
      wasm.local$get, ...type_size,
      wasm.mem$prefix,
      wasm.mem$fill, 0,
      wasm.local$get, ...addr,
    wasm.else,
      // if == 0, then we need to calculate the next maximum address
      wasm.local$get, ...type_size,
      wasm.call, ...get_next_address.func_idx_leb128,
    wasm.end,
  );
});

const free_mem = func_builder(function (func) {
  const addr = func.param(wasm.i32),
        size = func.param(wasm.i32);
  func.set_export("free_mem");
  func.append_code(
    wasm.local$get, ...addr,
    // size is the address where last freed address is stored
    wasm.local$get, ...size,
    wasm.local$get, ...addr,
    wasm.atomic$prefix,
    // put the address there -- this returns previous stored address
    wasm.i32$atomic$rmw$xchg, 2, 0,
    wasm.atomic$prefix,
    // store previous address in addr
    wasm.i32$atomic$store, 2, 0
  );
});

const get_ops_for_field_type = func_builder(function (func) {
  const field_type = func.param(wasm.i32),
        field_size = func.local(wasm.i32),
        mem_size = func.local(wasm.i32),
        load_op = func.local(wasm.i32),
        store_op = func.local(wasm.i32),
        const_op = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...field_type,
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.i32$eq,
    wasm.if, wasm.void,
      wasm.i32$const, 4,
      wasm.local$set, ...field_size,
      wasm.i32$const, 2,
      wasm.local$set, ...mem_size,
      wasm.i32$const, ...leb128(wasm.i32$load),
      wasm.local$set, ...load_op,
      wasm.i32$const, ...leb128(wasm.i32$store),
      wasm.local$set, ...store_op,
      wasm.i32$const, ...leb128(wasm.i32$const),
      wasm.local$set, ...const_op,
    wasm.end,
    wasm.local$get, ...field_type,
    wasm.i32$const, ...leb128(wasm.i64),
    wasm.i32$eq,
    wasm.if, wasm.void,
      wasm.i32$const, 8,
      wasm.local$set, ...field_size,
      wasm.i32$const, 3,
      wasm.local$set, ...mem_size,
      wasm.i32$const, ...leb128(wasm.i64$load),
      wasm.local$set, ...load_op,
      wasm.i32$const, ...leb128(wasm.i64$store),
      wasm.local$set, ...store_op,
      wasm.i32$const, ...leb128(wasm.i64$const),
      wasm.local$set, ...const_op,
    wasm.end,
    wasm.local$get, ...field_type,
    wasm.i32$const, ...leb128(wasm.f64),
    wasm.i32$eq,
    wasm.if, wasm.void,
      wasm.i32$const, 8,
      wasm.local$set, ...field_size,
      wasm.i32$const, 3,
      wasm.local$set, ...mem_size,
      wasm.i32$const, ...leb128(wasm.f64$load),
      wasm.local$set, ...load_op,
      wasm.i32$const, ...leb128(wasm.f64$store),
      wasm.local$set, ...store_op,
      wasm.i32$const, ...leb128(wasm.f64$const),
      wasm.local$set, ...const_op,
    wasm.end,
    wasm.local$get, ...field_size,
    wasm.local$get, ...mem_size,
    wasm.local$get, ...load_op,
    wasm.local$get, ...store_op,
    wasm.local$get, ...const_op
  );
});

const make_accessor_func = func_builder(function (func) {
  const type_size = func.param(wasm.i32),
        field_name = func.param(wasm.i32),
        result_type = func.param(wasm.i32),
        mem_size = func.param(wasm.i32),
        load_op = func.param(wasm.i32),
        _func = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.call, ...start_func.func_idx_leb128,
    wasm.local$tee, ..._func,
    wasm.local$get, ...field_name,
    wasm.call, ...set_export.func_idx_leb128,
    // first param is value address
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.call, ...add_param.func_idx_leb128,
    // result type is field type
    wasm.local$get, ...result_type,
    wasm.call, ...add_result.func_idx_leb128,
    // get value address
    wasm.i32$const, ...leb128(wasm.local$get),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...append_varuint32.func_idx_leb128,
    // add type-size (current offset)
    wasm.i32$const, ...leb128(wasm.i32$const),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...type_size,
    wasm.call, ...append_varsint32.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32$add),
    wasm.call, ...append_code.func_idx_leb128,
    // load data
    wasm.local$get, ...load_op,
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...mem_size,
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.call, ...end_func.func_idx_leb128
  );
});

// todo: use offset instead of setter_func
const add_field_to_type_constructor = func_builder(function (func) {
  const inner_func = func.param(wasm.i32),
        outer_func = func.param(wasm.i32),
        field_offset = func.param(wasm.i32),
        field_num = func.param(wasm.i32),
        param_num = func.param(wasm.i32),
        field_type = func.param(wasm.i32),
        use_default = func.param(wasm.i32),
        _default = func.param(wasm.i32),
        const_op = func.param(wasm.i32),
        setter_func = func.param(wasm.i32);
  func.add_result(wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...inner_func,
    wasm.local$get, ...field_type,
    wasm.call, ...add_param.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.local$get),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.local$get),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...field_num,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.local$tee, ...field_num,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.call),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...setter_func,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.drop,
    wasm.local$get, ...use_default,
    // if default given, then add it to the code of the constructor_func
    wasm.if, wasm.i32,
      wasm.local$get, ...outer_func,
      wasm.local$get, ...const_op,
      wasm.call, ...append_code.func_idx_leb128,
      wasm.local$get, ..._default,
      wasm.call, ...append_varsint32.func_idx_leb128,
    // otherwise, add it as a parameter to the constructor_func
    wasm.else,
      wasm.local$get, ...outer_func,
      wasm.local$get, ...field_type,
      wasm.call, ...add_param.func_idx_leb128,
      wasm.i32$const, ...leb128(wasm.local$get),
      wasm.call, ...append_code.func_idx_leb128,
      wasm.local$get, ...param_num,
      wasm.call, ...append_varuint32.func_idx_leb128,
      // increment param_num for next call of add_field...
      wasm.local$get, ...param_num,
      wasm.i32$const, 1,
      wasm.i32$add,
      wasm.local$set, ...param_num,
    wasm.end,
    wasm.drop,
    wasm.local$get, ...field_num,
    wasm.local$get, ...param_num
  );
});

const create_setter_func = func_builder(function (func) {
  const field_type = func.param(wasm.i32),
        offset = func.param(wasm.i32),
        mem_size = func.param(wasm.i32),
        store_op = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.call, ...start_func.func_idx_leb128,
    // first param is value address
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.call, ...add_param.func_idx_leb128,
    wasm.local$get, ...field_type,
    wasm.call, ...add_param.func_idx_leb128,
    // get value address
    wasm.i32$const, ...leb128(wasm.local$get),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32$const),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...offset,
    wasm.call, ...append_varsint32.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32$add),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.local$get),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 1,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.local$get, ...store_op,
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...mem_size,
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.call, ...end_func.func_idx_leb128
  );
});

const add_type_field = func_builder(function (func) {
  const inner_func = func.param(wasm.i32),
        outer_func = func.param(wasm.i32),
        type_size = func.param(wasm.i32),
        field_num = func.param(wasm.i32),
        param_num = func.param(wasm.i32),
        field_name = func.param(wasm.i32),
        field_type = func.param(wasm.i32),
        use_default = func.param(wasm.i32),
        _default = func.param(wasm.i32),
        field_size = func.local(wasm.i32),
        mem_size = func.local(wasm.i32),
        load_op = func.local(wasm.i32),
        store_op = func.local(wasm.i32),
        const_op = func.local(wasm.i32),
        getter_func = func.local(wasm.i32);
  func.set_export("add_type_field");
  func.add_result(
    // new type_size
    wasm.i32,
    // new field_num
    wasm.i32,
    // new param_num
    wasm.i32,
    // getter func
    wasm.i32
  );
  func.append_code(
    wasm.local$get, ...field_type,
    wasm.call, ...get_ops_for_field_type.func_idx_leb128,
    wasm.local$set, ...const_op,
    wasm.local$set, ...store_op,
    wasm.local$set, ...load_op,
    wasm.local$set, ...mem_size,
    wasm.local$set, ...field_size,

    wasm.local$get, ...type_size,
    wasm.local$get, ...field_name,
    wasm.local$get, ...field_type,
    wasm.local$get, ...mem_size,
    wasm.local$get, ...load_op,
    wasm.call, ...make_accessor_func.func_idx_leb128,
    wasm.local$set, ...getter_func,

    wasm.local$get, ...inner_func,
    wasm.local$get, ...outer_func,
    wasm.local$get, ...type_size,
    wasm.local$get, ...field_num,
    wasm.local$get, ...param_num,
    wasm.local$get, ...field_type,
    wasm.local$get, ...use_default,
    wasm.local$get, ..._default,
    wasm.local$get, ...const_op,

    wasm.local$get, ...field_type,
    wasm.local$get, ...type_size,
    wasm.local$get, ...mem_size,
    wasm.local$get, ...store_op,
    wasm.call, ...create_setter_func.func_idx_leb128,

    wasm.call, ...add_field_to_type_constructor.func_idx_leb128,
    wasm.local$set, ...param_num,
    wasm.local$set, ...field_num,

    wasm.local$get, ...type_size,
    wasm.local$get, ...field_size,
    wasm.i32$add,
    wasm.local$get, ...field_num,
    wasm.local$get, ...param_num,
    wasm.local$get, ...getter_func
  );
});

const start_type = func_builder(function (func) {
  func.set_export("start_type");
  func.add_result(wasm.i32, wasm.i32);
  func.append_code(
    wasm.call, ...start_func.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.call, ...add_param.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.call, ...add_result.func_idx_leb128,
    wasm.call, ...start_func.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.call, ...add_result.func_idx_leb128
  );
});

const end_type = func_builder(function (func) {
  const inner_func = func.param(wasm.i32),
        outer_func = func.param(wasm.i32),
        type_size = func.param(wasm.i32),
        field_num = func.param(wasm.i32),
        type_name = func.param(wasm.i32);
  func.set_export("end_type");
  func.add_result(
    wasm.i32,
    wasm.i32,
    wasm.i32
  );
  func.append_code(
    wasm.local$get, ...outer_func,
    wasm.local$get, ...type_name,
    wasm.call, ...set_export.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.call),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...inner_func,
    wasm.i32$const, ...leb128(wasm.local$get),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.call, ...end_func.func_idx_leb128,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.i32$const, ...leb128(alloc.func_idx),
    wasm.call, ...prepend_varuint32.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.call),
    wasm.call, ...prepend_code.func_idx_leb128,
    wasm.local$get, ...type_size,
    wasm.call, ...prepend_varsint32.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32$const),
    wasm.call, ...prepend_code.func_idx_leb128,
    wasm.call, ...end_func.func_idx_leb128,
    wasm.local$get, ...field_num,
    wasm.local$get, ...type_size
  );
});

compile();

/*------------*\
|              |
| define types |
|              |
\*------------*/

const types = {};

let next_type_num = 0;

function define_type (type_name, ...fields) {
  let [inner_func, outer_func] = comp.start_type(),
      type_size = 0,
      field_num = 0,
      param_num = 0;
  const type_num = next_type_num++,
        params = [],
        type_info = types[type_name] = {
          name: type_name,
          type_num: type_num,
          fields: {}
        };
  fields.unshift("_type_num", "i32", 1, type_num, 0);
  for (let i = 0; i < fields.length; i += 5) {
    const field_name = fields[i],
          field_type = fields[i + 1],
          use_default = fields[i + 2],
          deft = fields[i + 3],
          comp_type = fields[i + 4],
          field_offset = type_size;
    let acc_func;
    if (!use_default) params.push({
      wasm_type: wasm[field_type],
      comp_type: comp_type
    });
    [
      type_size,
      field_num,
      param_num,
      acc_func
    ] = comp.add_type_field(
      inner_func,
      outer_func,
      type_size,
      field_num,
      param_num,
      store_ref(type_name + "$" + field_name),
      wasm[field_type],
      use_default, deft
    );
    type_info.fields[field_name] = {
      func_num: acc_func,
      leb128: uleb128(acc_func),
      wasm_type: wasm[field_type],
      comp_type: comp_type,
      offset: field_offset
    };
  }
  [
    outer_func,
    param_num,
    type_size
  ] = comp.end_type(
    inner_func,
    outer_func,
    type_size,
    param_num,
    store_ref(type_name)
  );
  type_info.constr = {
    func_num: outer_func,
    leb128: uleb128(outer_func),
    params: params
  };
  type_info.size = type_size;
}

define_type("Nil");
define_type("False");
define_type("True");

define_type(
  "Boxedi32",
  "refs", "i32", 1, 0, 0,
  "value", "i32", 0, 0, 0
);

define_type(
  "Int",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "value", "i64", 0, 0, wasm.i64
);

define_type(
  "Float",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "value", "f64", 0, 0, wasm.f64
);

define_type(
  "Object",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "address", "i32", 0, 0, 0
);

define_type(
  "String",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "arr", "i32", 0, 0, wasm.i32,
  "length", "i32", 0, 0, wasm.i64
);

define_type(
  "File",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "fd", "i32", 0, 0, wasm.i64
);

define_type(
  "Symbol",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "namespace", "i32", 0, 0, wasm.i32,
  "name", "i32", 0, 0, wasm.i32
);

define_type(
  "Keyword",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "namespace", "i32", 0, 0, wasm.i32,
  "name", "i32", 0, 0, wasm.i32,
);

define_type(
  "Function",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "func_num", "i32", 0, 0, 0,
  "macro", "i32", 0, 0, wasm.i64,
  "tbl_idx", "i32", 0, 0, 0,
  "type_num", "i32", 0, 0, 0,
  "result",  "i32", 0, 0, wasm.i64,
  "i32_params", "i32", 0, 0, wasm.i64,
  "i64_params", "i32", 0, 0, wasm.i64,
  "f64_params", "i32", 0, 0, wasm.i64
);

define_type(
  "Method",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "num", "i32", 0, 0, 0,
  "default_func", "i32", 0, 0, 0,
  "main_func", "i32", 0, 0, 0
);

define_type(
  "Array",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
// todo: change to "memblk"
  "arr", "i32", 0, 0, 0,
// todo: change to "size"
  "length", "i32", 0, 0, wasm.i64,
  "original", "i32", 0, 0, 0
);

define_type(
  "RefsArray",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "arr", "i32", 0, 0, 0
);

define_type(
  "Atom",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "data", "i32", 0, 0, 0,
  "mutex", "i32", 0, 0, 0
);

define_type(
  "TaggedData",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "tag", "i32", 0, 0, wasm.i32,
  "data", "i32", 0, 0, wasm.i32
);

define_type(
  "Metadata",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "meta", "i32", 0, 0, wasm.i32,
  "data", "i32", 0, 0, wasm.i32
);

define_type(
  "Type",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "num", "i32", 0, 0, 0
);

define_type(
  "BitmapIndexedNode",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "bitmap", "i32", 0, 0, 0,
  "arr", "i32", 0, 0, 0
);

define_type(
  "ArrayNode",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "count", "i32", 0, 0, 0,
  "arr", "i32", 0, 0, 0
);

define_type(
  "HashCollisionNode",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "collision_hash", "i32", 0, 0, 0,
  "count", "i32", 0, 0, 0,
  "arr", "i32", 0, 0, 0
);

define_type(
  "HashMap",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "count", "i32", 0, 0, wasm.i64,
  "root", "i32", 0, 0, 0,
  "has_nil", "i32", 0, 0, 0,
  "nil_val", "i32", 0, 0, 0
);

define_type(
  "Vector",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "count", "i32", 0, 0, wasm.i64,
  "shift", "i32", 0, 0, 0,
  "root", "i32", 0, 0, 0,
  "tail", "i32", 0, 0, 0
);

define_type(
  "VectorSeq",
  "refs", "i32", 1, 0, 0,
  "local_refs", "i32", 1, 1, 0,
  "hash", "i32", 1, 0, 0,
  "count", "i32", 0, 0, wasm.i64,
  "vec", "i32", 0, 0, wasm.i32,
  "offset", "i32", 0, 0, 0
);

// /*-------*\
// |         |
// | partial |
// |         |
// \*-------*/
// 
// const def_partial = func_builder(function (func) {
//   const func_num = func.param(wasm.i32),
//         args = func.param(wasm.i32);
//   func.add_result(wasm.i32);
//   func.append_code(
//     wasm.local$get, ...func_num,
//     wasm.call, ...add_partial_to_table.func_idx_leb128,
//     wasm.local$get, ...args,
//     wasm.call, ...PartialFunc.constr_leb128
//   );
// });
// 
// const call_partial = func_builder(function (func) {
//   const partial = func.param(wasm.i32);
//   func.add_result(wasm.i32);
//   func.append_code(
//     wasm.local$get, ...partial,
//     wasm.call, ...PartialFunc.args_leb128,
//     wasm.local$get, ...partial,
//     wasm.call, ...PartialFunc.tbl_idx_leb128,
//     wasm.call_indirect,
//     ...leb128i32(get_type_idx(1, 0, 0, wasm.i32)), 0
//   );
// });

/*-------*\
|         |
| def_mtd |
|         |
\*-------*/

// add a param to the default func and main func of a polymethod
const add_params_to_main_mtd_func = func_builder(function (func) {
  const main_func = func.param(wasm.i32),
        start_param = func.param(wasm.i32),
        num_params = func.param(wasm.i32),
        param_type = func.param(wasm.i32),
        curr_param = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32);
  func.append_code(
    // data type and number of params provided
    // loop here through the number of params
    wasm.loop, wasm.void,
      wasm.local$get, ...curr_param,
      wasm.local$get, ...num_params,
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        // add the param to the main func
        wasm.local$get, ...main_func,
        wasm.local$get, ...param_type,
        wasm.call, ...add_param.func_idx_leb128,
        // add to the code of main func
        // (local.get n) where n is the param num we started on plus curr_param
        wasm.i32$const, ...leb128(wasm.local$get),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.local$get, ...start_param,
        wasm.local$get, ...curr_param,
        wasm.i32$add,
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.drop,
        wasm.local$get, ...curr_param,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$set, ...curr_param,
        wasm.br, 1,
      wasm.end,
    wasm.end,
    wasm.local$get, ...main_func,
    wasm.local$get, ...start_param,
    wasm.local$get, ...num_params,
    wasm.i32$add
  );
});

// finish the main func for a method, which is the function directly called
const finish_mtd_main_func = func_builder(function (func) {
  const main_func = func.param(wasm.i32),
        type_idx = func.param(wasm.i32),
        poly_table = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    // get the first arg
    wasm.local$get, ...main_func,
    wasm.i32$const, ...leb128(wasm.local$get),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...append_varuint32.func_idx_leb128,
    // load the type num from the address
    wasm.i32$const, ...leb128(wasm.i32$load),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 2,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...append_varuint32.func_idx_leb128,
    // call_indirect using the type num as the index to the poly table
    wasm.i32$const, ...leb128(wasm.call_indirect),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...type_idx,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.local$get, ...poly_table,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.call, ...end_func.func_idx_leb128
  );
});

const new_comp_method = func_builder(function (func) {
  const mtd_name = func.param(wasm.i32),
        i32_params = func.param(wasm.i32),
        i64_params = func.param(wasm.i32),
        f64_params = func.param(wasm.i32),
        result_type = func.param(wasm.i32),
        mtd_table = func.local(wasm.i32),
        main_func = func.local(wasm.i32),
        type_idx = func.local(wasm.i32),
        num_params = func.local(wasm.i32);
  func.set_export("new_comp_method");
  func.add_result(wasm.i32, wasm.i32);
  func.append_code(
    // start main func
    wasm.call, ...start_func.func_idx_leb128,
    wasm.local$tee, ...main_func,
    wasm.local$get, ...mtd_name,
    wasm.if, wasm.void,
      wasm.local$get, ...main_func,
      wasm.local$get, ...mtd_name,
      wasm.call, ...set_export.func_idx_leb128,
      wasm.drop,
    wasm.end,
    wasm.local$get, ...result_type,
    wasm.if, wasm.void,
      wasm.local$get, ...main_func,
      wasm.local$get, ...result_type,
      wasm.call, ...add_result.func_idx_leb128,
      wasm.drop,
    wasm.end,
    wasm.i32$const, 0,
    wasm.local$get, ...i32_params,
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.call, ...add_params_to_main_mtd_func.func_idx_leb128,
    wasm.local$get, ...i64_params,
    wasm.i32$const, ...leb128(wasm.i64),
    wasm.call, ...add_params_to_main_mtd_func.func_idx_leb128,
    wasm.local$get, ...f64_params,
    wasm.i32$const, ...leb128(wasm.f64),
    wasm.call, ...add_params_to_main_mtd_func.func_idx_leb128,
    // drop last two results of add_params_to_main_mtd_func
    wasm.drop,
    wasm.drop,
    // set up mtd_table
    wasm.call, ...func_table.func_idx_leb128,
    wasm.local$set, ...mtd_table,
    // get type index
    wasm.local$get, ...i32_params,
    wasm.local$get, ...i64_params,
    wasm.local$get, ...f64_params,
    wasm.local$get, ...result_type,
    wasm.call, ...get_type_idx.func_idx_leb128,
    wasm.local$set, ...type_idx,
    // finish main func
    wasm.local$get, ...main_func,
    wasm.local$get, ...type_idx,
    wasm.local$get, ...mtd_table,
    wasm.call, ...finish_mtd_main_func.func_idx_leb128,
    wasm.local$get, ...mtd_table
  );
});

compile();

const defined_methods = [];

function def_mtd (name, num_i32, num_i64, num_f64, res, def_func) {
  if (def_func) {
    if (typeof def_func === "function") def_func = func_builder(def_func);
  } else if (!def_func) {
    def_func = { func_idx: 0, func_idx_leb128: [0] };
  }
  const [ mtd_func, mtd_num ] = comp.new_comp_method(
    name ? leb128(store_ref(name)) : [0],
    num_i32, num_i64, num_f64, res,
  );
  return {
    name: name,
    mtd_num: mtd_num,
    num_args: num_i32 + num_i64 + num_f64,
    def_func: def_func.func_idx,
    def_func_leb128: def_func.func_idx_leb128,
    func_idx: mtd_func,
    func_idx_leb128: uleb128(mtd_func),
    implemented: {},
    implement: function (type, func) {
      this.implemented[type.name] = true;
      impl_method(
        mtd_num, type.type_num, (
          func instanceof Function ?
          func_builder(func).func_idx :
          func
        )
      );
    }
  };
}

function pre_new_method (name, num_i32, num_i64, num_f64, res, def_func) {
  num_i64 ||= 0;
  num_f64 ||= 0;
  if (res !== 0) res = wasm[res || "i32"];
  const out = def_mtd(name, num_i32, num_i64, num_f64, res, def_func);
  defined_methods.push(out);
  for (let i = 0; i < next_type_num; i++) {
    impl_method(out.mtd_num, i, out.def_func);
  }
  return out;
}

/*----*\
|      |
| free |
|      |
\*----*/

const free = pre_new_method("free", 1, 0, 0, 0);

const dec_refs = func_builder(function (func) {
  const val = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...val,
    wasm.i32$const, ...leb128(types.Symbol.fields.refs.offset),
    wasm.i32$add,
    wasm.i32$const, 1,
    wasm.atomic$prefix,
    // atomically subtract 1 from refs, returns previous value:
    wasm.i32$atomic$rmw$sub, 2, 0
  );
});

function impl_free (type, own_free) {
  free.implement(type, function (func) {
    const val = func.param(wasm.i32),
          refs = func.local(wasm.i32);
    func.append_code(
      wasm.local$get, ...val,
      wasm.call, ...dec_refs.func_idx_leb128,
      // if refs was 0 before dec_refs, proceed with cleanup
      wasm.i32$eqz,
      wasm.if, wasm.void,
        // type-specific cleanup:
        wasm.local$get, ...val,
        wasm.call, ...func_builder(own_free).func_idx_leb128,
        // free value itself:
        wasm.if, wasm.void,
          wasm.local$get, ...val,
          wasm.i32$const, ...leb128(type.size),
          wasm.call, ...free_mem.func_idx_leb128,
        wasm.end,
      wasm.end
    );
  });
}

// value should never be freed:
const no_free = func => func.param(wasm.i32);

free.implement(types.Nil, no_free);
free.implement(types.False, no_free);
free.implement(types.True, no_free);
free.implement(types.Symbol, no_free);
free.implement(types.Keyword, no_free);
free.implement(types.Method, no_free);
free.implement(types.Type, no_free);

// no type-specific cleanup, just use default:
function simple_free (func) {
  func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.i32$const, 1);
}

impl_free(types.Boxedi32, simple_free);
impl_free(types.Int, simple_free);
impl_free(types.Float, simple_free);
impl_free(types.Function, simple_free);

const inc_refs = pre_new_method("inc_refs", 1, 0, 0, "i32",
  function (func) {
    const val = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...val,
      wasm.i32$const, ...leb128(types.Symbol.fields.refs.offset),
      wasm.i32$add,
      wasm.i32$const, 1,
      wasm.atomic$prefix,
      wasm.i32$atomic$rmw$add, 2, 0,
      wasm.drop,
      wasm.local$get, ...val,
    );
  }
);

function no_inc_refs (func) {
  const val = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.local$get, ...val);
}

inc_refs.implement(types.Nil, no_inc_refs);
inc_refs.implement(types.False, no_inc_refs);
inc_refs.implement(types.True, no_inc_refs);
inc_refs.implement(types.Symbol, no_inc_refs);
inc_refs.implement(types.Keyword, no_inc_refs);
inc_refs.implement(types.Method, no_inc_refs);
inc_refs.implement(types.Type, no_inc_refs);

/*-----*\
|       |
| Array |
|       |
\*-----*/

// todo: check index against array length (in comp)
function array_getter (align, res_typ, load) {
  return func_builder(function (func) {
    const arr = func.param(wasm.i32),
          idx = func.param(wasm.i32);
    func.add_result(wasm[res_typ]);
    func.append_code(
      wasm.local$get, ...arr,
      wasm.call, ...types.Array.fields.arr.leb128,
      wasm.local$get, ...idx,
      wasm.i32$const, align,
      wasm.i32$shl,
      wasm.i32$add,
      wasm[load], align, 0
    );
  });
}

const array_get_i8  = array_getter(0, "i32", "i32$load8_u");
const array_get_i32 = array_getter(2, "i32", "i32$load");
const array_get_i64 = array_getter(3, "i64", "i64$load");
const array_get_f64 = array_getter(3, "f64", "f64$load");

const refs_array_get = func_builder(function (func) {
  const arr = func.param(wasm.i32),
        idx = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...arr,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.local$get, ...idx,
    wasm.call, ...array_get_i32.func_idx_leb128
  );
});

// todo: check index against array length (in comp)
function array_setter (align, val_typ, store) {
  return func_builder(function (func) {
    const arr = func.param(wasm.i32),
          idx = func.param(wasm.i32),
          val = func.param(wasm[val_typ]);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...arr,
      wasm.call, ...types.Array.fields.arr.leb128,
      wasm.local$get, ...idx,
      wasm.i32$const, align,
      wasm.i32$shl,
      wasm.i32$add,
      wasm.local$get, ...val,
      wasm[store], align, 0,
      wasm.local$get, ...arr
    );
  });
}

const array_set_i8  = array_setter(0, "i32", "i32$store8");
const array_set_i32 = array_setter(2, "i32", "i32$store");
const array_set_i64 = array_setter(3, "i64", "i64$store");
const array_set_f64 = array_setter(3, "f64", "f64$store");

const refs_array_set_no_inc = func_builder(function (func) {
  const arr = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        val = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    // stage the return val before we overwrite the variable
    wasm.local$get, ...arr,
    wasm.local$get, ...arr,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.local$tee, ...arr,
    wasm.local$get, ...idx,
    wasm.call, ...array_get_i32.func_idx_leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...arr,
    wasm.local$get, ...idx,
    wasm.local$get, ...val,
    wasm.call, ...array_set_i32.func_idx_leb128,
    wasm.drop
  );
});

const refs_array_set = func_builder(function (func) {
  const arr = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        val = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    // stage the return val before we overwrite the variable
    wasm.local$get, ...arr,
    wasm.local$get, ...arr,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.local$tee, ...arr,
    wasm.local$get, ...idx,
    wasm.call, ...array_get_i32.func_idx_leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...arr,
    wasm.local$get, ...idx,
    wasm.local$get, ...val,
    wasm.call, ...inc_refs.func_idx_leb128,
    wasm.call, ...array_set_i32.func_idx_leb128,
    wasm.drop
  );
});

// todo: test that len < arr.len (in comp)
const subarray = func_builder(function (func) {
  const arr = func.param(wasm.i32),
        start = func.param(wasm.i32),
        len = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...arr,
    wasm.call, ...inc_refs.func_idx_leb128,
    wasm.call, ...types.Array.fields.arr.leb128,
    wasm.local$get, ...start,
    wasm.i32$add,
    wasm.local$get, ...len,
    wasm.local$get, ...arr,
    wasm.call, ...types.Array.constr.leb128
  );
});

const refs_subarray = func_builder(function (func) {
  const arr = func.param(wasm.i32),
        start = func.param(wasm.i32),
        len = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...arr,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.local$get, ...start,
    wasm.local$get, ...len,
    wasm.call, ...subarray.func_idx_leb128,
    wasm.call, ...types.RefsArray.constr.leb128
  );
});

impl_free(types.Array, function (func) {
  const arr = func.param(wasm.i32),
        org = func.local(wasm.i32),
        idx = func.local(wasm.i32),
        len = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    // if this is a subarray:
    wasm.local$get, ...arr,
    wasm.call, ...types.Array.fields.original.leb128,
    wasm.local$tee, ...org,
    wasm.if, wasm.void,
      wasm.local$get, ...org,
      wasm.call, ...free.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...arr,
      wasm.call, ...types.Array.fields.length.leb128,
      wasm.i32$const, 2,
      wasm.i32$shl,
      wasm.local$set, ...len,
      wasm.local$get, 0,
      wasm.call, ...types.Array.fields.arr.leb128,
      wasm.local$set, ...arr,
      wasm.loop, wasm.void,
        // can only free in chunks of max_inst_size
        wasm.local$get, ...len,
        wasm.i32$const, ...leb128(max_inst_size),
        wasm.i32$gt_u,
        wasm.if, wasm.void,
          wasm.local$get, ...arr,
          wasm.i32$const, ...leb128(max_inst_size),
          wasm.call, ...free_mem.func_idx_leb128,
          wasm.local$get, ...arr,
          wasm.i32$const, ...leb128(max_inst_size),
          wasm.i32$add,
          wasm.local$set, ...arr,
          wasm.local$get, ...len,
          wasm.i32$const, ...leb128(max_inst_size),
          wasm.i32$sub,
          wasm.local$set, ...len,
          wasm.br, 1,
        wasm.else,
          wasm.local$get, ...len,
          wasm.if, wasm.void,
            wasm.local$get, ...arr,
            wasm.local$get, ...len,
            wasm.call, ...free_mem.func_idx_leb128,
          wasm.end,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.i32$const, 1
  );
});

impl_free(types.RefsArray, function (func) {
  const arr = func.param(wasm.i32),
        idx = func.local(wasm.i32),
        cnt = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...arr,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.local$tee, ...arr,
    wasm.call, ...types.Array.fields.length.leb128,
    wasm.local$set, ...cnt,
    wasm.loop, wasm.void,
      wasm.local$get, ...idx,
      wasm.local$get, ...cnt,
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        wasm.local$get, ...arr,
        wasm.local$get, ...idx,
        wasm.call, ...array_get_i32.func_idx_leb128,
        wasm.call, ...free.func_idx_leb128,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$set, ...idx,
        wasm.br, 1,
      wasm.end,
    wasm.end,
    wasm.local$get, ...arr,
    wasm.call, ...free.func_idx_leb128,
    wasm.i32$const, 1
  );
});

const array_by_length = func_builder(function (func) {
  const len = func.param(wasm.i32),
        size = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.set_export("array_by_length");
  func.append_code(
    wasm.local$get, ...len,
    wasm.if, wasm.i32,
      wasm.local$get, ...len,
      // len is number of i32s, so multiply by 4 for number of bytes
      wasm.i32$const, 2,
      wasm.i32$shl,
      wasm.local$tee, ...size,
      wasm.i32$const, ...leb128(max_inst_size),
      wasm.i32$gt_u,
      wasm.if, wasm.i32,
        // if > max_inst_size, reserve a new address space
        // this will be freed later in chunks of max_inst_size
        wasm.local$get, ...size,
        wasm.call, ...get_next_address.func_idx_leb128,
      wasm.else,
        // if <= max_inst_size, use alloc to get a free block as usual
        wasm.local$get, ...size,
        wasm.call, ...alloc.func_idx_leb128,
      wasm.end,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end,
    wasm.local$get, ...len,
    wasm.i32$const, 0,
    wasm.call, ...types.Array.constr.leb128
  );
});

const refs_array_by_length = func_builder(function (func) {
  const len = func.param(wasm.i32);
  func.set_export("refs_array_by_length");
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...len,
    wasm.call, ...array_by_length.func_idx_leb128,
    wasm.call, ...types.RefsArray.constr.leb128
  );
});

const array_copy = func_builder(function (func) {
  const src = func.param(wasm.i32),
        i = func.param(wasm.i32),
        dst = func.param(wasm.i32),
        j = func.param(wasm.i32),
        len = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...dst,
    wasm.call, ...types.Array.fields.arr.leb128,
    wasm.local$get, ...j,
    wasm.i32$add,
    wasm.local$get, ...src,
    wasm.call, ...types.Array.fields.arr.leb128,
    wasm.local$get, ...i,
    wasm.i32$add,
    wasm.local$get, ...len,
    wasm.mem$prefix,
    wasm.mem$copy, 0, 0,
    wasm.local$get, ...dst
  );
});

const refs_array_copy = func_builder(function (func) {
  const src = func.param(wasm.i32),
        i = func.param(wasm.i32),
        dst = func.param(wasm.i32),
        j = func.param(wasm.i32),
        len = func.param(wasm.i32),
        idx = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    // can't bulk copy because we need to inc_refs each element
    wasm.loop, wasm.void,
      wasm.local$get, ...idx,
      wasm.local$get, ...len,
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        wasm.local$get, ...dst,
        wasm.local$get, ...j,
        wasm.local$get, ...idx,
        wasm.i32$add,
        wasm.local$get, ...src,
        wasm.local$get, ...i,
        wasm.local$get, ...idx,
        wasm.i32$add,
        wasm.call, ...refs_array_get.func_idx_leb128,
        wasm.call, ...refs_array_set.func_idx_leb128,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$set, ...idx,
        wasm.br, 1,
      wasm.end,
    wasm.end,
    wasm.local$get, ...dst
  );
});

const refs_array_fit = func_builder(function (func) {
  const len = func.param(wasm.i32),
        idx = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...len,
    wasm.local$get, ...idx,
    wasm.i32$gt_u,
    wasm.if, wasm.i32,
      wasm.local$get, ...len,
    wasm.else,
      wasm.local$get, ...idx,
      wasm.i32$const, 1,
      wasm.i32$add,
    wasm.end,
    wasm.call, ...refs_array_by_length.func_idx_leb128
  );
});

const array_push_i32 = func_builder(function (func) {
  const src = func.param(wasm.i32),
        val = func.param(wasm.i32),
        len = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...src,
    wasm.i32$const, 0,
    wasm.local$get, ...src,
    wasm.call, ...types.Array.fields.length.leb128,
    wasm.local$tee, ...len,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.call, ...array_by_length.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.local$get, ...len,
    wasm.i32$const, 2,
    wasm.i32$shl,
    wasm.call, ...array_copy.func_idx_leb128,
    wasm.local$get, ...len,
    wasm.local$get, ...val,
    wasm.call, ...array_set_i32.func_idx_leb128,
  );
});

const refs_array_fit_and_copy = func_builder(function (func) {
  const src = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        len = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...src,
    wasm.i32$const, 0,
    wasm.local$get, ...src,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.call, ...types.Array.fields.length.leb128,
    wasm.local$tee, ...len,
    wasm.local$get, ...idx,
    wasm.call, ...refs_array_fit.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.local$get, ...len,
    wasm.call, ...refs_array_copy.func_idx_leb128
  );
});

const refs_array_clone = func_builder(function (func) {
  const src = func.param(wasm.i32),
        len = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...src,
    wasm.i32$const, 0,
    wasm.local$get, ...src,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.call, ...types.Array.fields.length.leb128,
    wasm.local$tee, ...len,
    wasm.call, ...refs_array_by_length.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.local$get, ...len,
    wasm.call, ...refs_array_copy.func_idx_leb128
  );
});

compile();

const empty_refs_array = comp.refs_array_by_length(0);

/*----*\
|      |
| Atom |
|      |
\*----*/

const swap_lock = func_builder(function (func) {
  const mutex_addr = func.param(wasm.i32);
  func.append_code(
    wasm.loop, wasm.void,
      wasm.local$get, ...mutex_addr,
      wasm.i32$const, 0,
      wasm.i32$const, 1,
      wasm.atomic$prefix,
      wasm.i32$atomic$rmw$cmpxchg, 2, 0,
      wasm.if, wasm.void,
        wasm.local$get, ...mutex_addr,
        wasm.i32$const, 1,
        wasm.i64$const, ...leb128(-1n),
        wasm.atomic$prefix,
        wasm.memory$atomic$wait32, 2, 0,
        wasm.drop,
        wasm.br, 1,
      wasm.end,
    wasm.end
  );
});

const swap_unlock = func_builder(function (func) {
  const mutex_addr = func.param(wasm.i32);
  func.append_code(
    wasm.local$get, ...mutex_addr,
    wasm.i32$const, 0,
    wasm.atomic$prefix,
    wasm.i32$atomic$store, 2, 0,
    wasm.local$get, ...mutex_addr,
// todo: how many wake?
    wasm.i32$const, 1,
    wasm.atomic$prefix,
    wasm.memory$atomic$notify, 2, 0,
    wasm.drop
  );
});

/*
const atom_reset = func_builder(function (func) {
  const atom = func.param(wasm.i32),
        val = func.param(wasm.i32),
        mutex = func.local(wasm.i32),
        data = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...atom,
// todo: address getter
    wasm.i32$const, 12,
    wasm.i32$add,
    wasm.local$tee, ...mutex,
    wasm.call, ...swap_lock.func_idx_leb128,
// todo: reinstate setters, use here
    wasm.local$get, ...atom,
    wasm.i32$const, 8,
    wasm.i32$add,
    wasm.local$tee, ...data,
    wasm.local$get, ...data,
    wasm.i32$load, 2, 0,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...val,
    wasm.call, ...inc_refs.func_idx_leb128,
    wasm.atomic$prefix,
    wasm.i32$atomic$store, 2, 0,
    wasm.local$get, ...mutex,
    wasm.call, ...swap_unlock.func_idx_leb128,
    wasm.local$get, ...val
  );
});
*/

const atom_swap_lock = func_builder(function (func) {
  const atom = func.param(wasm.i32);
// todo: need to export?
  func.set_export("swap_lock");
  func.add_result(wasm.i32);
  func.append_code(
    // mutex
    wasm.local$get, ...atom,
    wasm.i32$const, ...leb128(types.Atom.fields.mutex.offset),
    wasm.i32$add,
    wasm.call, ...swap_lock.func_idx_leb128,
    wasm.local$get, ...atom,
    wasm.call, ...types.Atom.fields.data.leb128
  );
});

const atom_swap_unlock = func_builder(function (func) {
  const atom = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    // mutex
    wasm.local$get, ...atom,
    wasm.i32$const, ...leb128(types.Atom.fields.mutex.offset),
    wasm.i32$add,
    wasm.call, ...swap_unlock.func_idx_leb128,
// todo: why returning?
    wasm.i32$const, 1
  );
});

// called when atom is already locked
const atom_swap_set = func_builder(function (func) {
  const atom = func.param(wasm.i32),
        val = func.param(wasm.i32),
        data = func.local(wasm.i32);
  func.add_result(wasm.i32);
// todo: need to export?
  func.set_export("swap_set");
  func.append_code(
    wasm.local$get, ...atom,
    wasm.i32$const, ...leb128(types.Atom.fields.data.offset),
    wasm.i32$add,
    wasm.local$tee, ...data,
    wasm.local$get, ...data,
    wasm.i32$load, 2, 0,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...val,
    wasm.call, ...inc_refs.func_idx_leb128,
    wasm.atomic$prefix,
    wasm.i32$atomic$store, 2, 0,
    wasm.local$get, ...atom,
    wasm.i32$const, ...leb128(types.Atom.fields.mutex.offset),
    wasm.i32$add,
    wasm.call, ...swap_unlock.func_idx_leb128,
    wasm.local$get, ...val
  );
});

const atom_deref = func_builder(function (func) {
  const atom = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...atom,
    wasm.i32$const, ...leb128(types.Atom.fields.data.offset),
    wasm.i32$add,
    wasm.atomic$prefix,
    wasm.i32$atomic$load, 2, 0
  );
});

/*
const watch = func_builder(function (func) {
  const atom = func.param(wasm.i32),
        fn = func.param(wasm.i32),
        thread_port = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.call, ...start_thread.func_idx_leb128,
    wasm.local$tee, ...thread_port,
    wasm.local$get, ...atom,
    wasm.i32$store, 2, 0,
    wasm.local$get, ...thread_port,
    wasm.i32$const, 1,
    wasm.atomic$prefix,
    wasm.memory$atomic$notify, 2, 0,
    wasm.drop,
    wasm.i32$const, 0
  );
});

const add_watch = func_builder(function (func) {
  const atom = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...atom,
    wasm.i32$const, 4,
    wasm.i32$add,
    wasm.i32$const, 1,
    wasm.i64$const, ...leb128(-1n),
    wasm.atomic$prefix,
    wasm.memory$atomic$wait32, 2, 0,
  );
});
*/

impl_free(types.Atom, function (func) {
  const atom = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...atom,
    wasm.call, ...types.Atom.fields.data.leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.i32$const, 1
  );
});

/*----------*\
|            |
| TaggedData |
|            |
\*----------*/

impl_free(types.TaggedData, function (func) {
  const td = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...td,
    wasm.call, ...types.TaggedData.fields.tag.leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...td,
    wasm.call, ...types.TaggedData.fields.data.leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.i32$const, 1
  );
});

/*--------*\
|          |
| Metadata |
|          |
\*--------*/

impl_free(types.Metadata, function (func) {
  const md = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...md,
    wasm.call, ...types.Metadata.fields.meta.leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...md,
    wasm.call, ...types.Metadata.fields.data.leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.i32$const, 1
  );
});

/*----*\
|      |
| math |
|      |
\*----*/

const i32_div_ceil = func_builder(function (func) {
  const dividend = func.param(wasm.i32),
        divisor = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...dividend,
    wasm.i32$const, 1,
    wasm.i32$sub,
    wasm.local$get, ...divisor,
    wasm.i32$div_u,
    wasm.i32$const, 1,
    wasm.i32$add
  );
});

const safe_add_i32 = func_builder(function (func) {
  const x = func.param(wasm.i32),
        y = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...y,
    wasm.i32$const, ...leb128(-1),
    wasm.local$get, ...x,
    wasm.i32$sub,
    wasm.i32$le_u,
    wasm.if, wasm.i32,
      wasm.local$get, ...x,
      wasm.local$get, ...y,
      wasm.i32$add,
    wasm.else,
      wasm.i32$const, def_exception("i32 overflow"),
      wasm.i32$const, 0,
      wasm.throw, 0,
    wasm.end
  );
});

const is_odd_i64 = func_builder(function (func) {
  const n = func.param(wasm.i64);
  func.add_result(wasm.i64);
  func.append_code(
    wasm.local$get, ...n,
    wasm.i64$const, 1,
    wasm.i64$and
  );
});

// https://en.wikipedia.org/wiki/Exponentiation_by_squaring
const pow = func_builder(function (func) {
  const x = func.param(wasm.f64),
        n = func.param(wasm.i64),
        r = func.local(wasm.f64);
  func.add_result(wasm.f64);
  func.append_code(
    wasm.loop, wasm.f64,
      wasm.local$get, ...n,
      wasm.i64$const, 0,
      wasm.i64$lt_s,
      wasm.if, wasm.f64,
        wasm.f64$const, 0, 0, 0, 0, 0, 0, 0xf0, 0x3f, // 1
        wasm.local$get, ...x,
        wasm.f64$div,
        wasm.local$set, ...x,
        wasm.local$get, ...n,
        wasm.i64$const, ...leb128(-1n),
        wasm.i64$mul,
        wasm.local$set, ...n,
        wasm.br, 1,
      wasm.else,
        wasm.local$get, ...n,
        wasm.i64$const, 0,
        wasm.i64$eq,
        wasm.if, wasm.f64,
          wasm.f64$const, 0, 0, 0, 0, 0, 0, 0xf0, 0x3f, // 1
        wasm.else,
          wasm.local$get, ...n,
          wasm.i64$const, 1,
          wasm.i64$eq,
          wasm.if, wasm.f64,
            wasm.local$get, ...x,
          wasm.else,
            wasm.local$get, ...x,
            wasm.local$get, ...x,
            wasm.f64$mul,
            wasm.local$set, ...x,
            wasm.local$get, ...n,
            wasm.call, ...is_odd_i64.func_idx_leb128,
            wasm.local$get, ...n,
            wasm.i64$const, 1,
            wasm.i64$shr_u,
            wasm.local$set, ...n,
            wasm.br, 3,
            wasm.local$set, ...r,
            // if odd
            wasm.if, wasm.f64,
              wasm.local$get, ...x,
              wasm.local$get, ...r,
              wasm.f64$mul,
            wasm.else,
              wasm.local$get, ...r,
            wasm.end,
          wasm.end,
        wasm.end,
      wasm.end,
    wasm.end
  );
});

/*---*\
|     |
| Int |
|     |
\*---*/

const i64_to_string = func_builder(function (func) {
  const num = func.param(wasm.i64),
        arr = func.local(wasm.i32),
        len = func.local(wasm.i32),
        idx = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.i32$const, 0,
    wasm.call, ...array_by_length.func_idx_leb128,
    wasm.local$set, ...arr,
    wasm.loop, wasm.void,
      wasm.local$get, ...arr,
      wasm.local$get, ...arr,
      wasm.i32$const, 0,
      wasm.local$get, ...len,
      wasm.local$tee, ...idx,
      wasm.i32$const, 1,
      wasm.i32$add,
      wasm.local$tee, ...len,
      wasm.i32$const, 4,
      wasm.call, ...i32_div_ceil.func_idx_leb128,
      wasm.call, ...array_by_length.func_idx_leb128,
      wasm.local$tee, ...arr,
      wasm.i32$const, 1,
      wasm.local$get, ...idx,
      wasm.call, ...array_copy.func_idx_leb128,
      wasm.i32$const, 0,
      wasm.local$get, ...num,
      wasm.i64$const, 10,
      wasm.i64$rem_u,
      wasm.i32$wrap_i64,
      wasm.i32$const, ...leb128(48),
      wasm.i32$add,
      wasm.call, ...array_set_i8.func_idx_leb128,
      wasm.local$set, ...arr,
      wasm.call, ...free.func_idx_leb128,
      wasm.local$get, ...num,
      wasm.i64$const, 10,
      wasm.i64$div_u,
      wasm.local$tee, ...num,
      wasm.i32$wrap_i64,
      wasm.br_if, 0,
    wasm.end,
    wasm.local$get, ...arr,
    wasm.local$get, ...len,
    wasm.call, ...types.String.constr.leb128
  );
});

const i32_to_string = func_builder(function (func) {
  const num = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...num,
    wasm.i64$extend_i32_u,
    wasm.call, ...i64_to_string.func_idx_leb128
  );
});

/*------*\
|        |
| String |
|        |
\*------*/

impl_free(types.String, function (func) {
  const str = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.call, ...types.String.fields.arr.leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.i32$const, 1
  );
});

impl_free(types.File, function (func) {
  const fstr = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...fstr,
    wasm.call, ...file_close.func_idx_leb128,
    wasm.i32$const, 1
  );
});

const string_length = pre_new_method(null, 1, 0, 0, "i32");

string_length.implement(types.String, types.String.fields.length.func_num);
string_length.implement(types.File, file_length.func_idx);

// converts segment of File to String in situations when
// we wouldn't need to call substring on a String
const get_string_chunk = pre_new_method(null, 3, 0, 0, "i32");

get_string_chunk.implement(types.String, function (func) {
  const str = func.param(wasm.i32);
  func.param(wasm.i32);
  func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.local$get, ...str);
});

get_string_chunk.implement(types.File, file_get_string_chunk.func_idx);

const substring = pre_new_method(null, 3, 0, 0, "i32");

// todo: test that len < str.len
substring.implement(types.String, function (func) {
  const str = func.param(wasm.i32),
        start = func.param(wasm.i32),
        len = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.call, ...types.String.fields.arr.leb128,
    wasm.local$get, ...start,
    // length is meaningless since array has to be multiples of four
    // and string uses its own length for iterating
    wasm.i32$const, 0,
    wasm.call, ...subarray.func_idx_leb128,
    wasm.local$get, ...len,
    wasm.call, ...types.String.constr.leb128
  );
});

substring.implement(types.File, file_get_string_chunk.func_idx);

const substring_to_end = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.local$get, ...str,
    wasm.call, ...types.String.fields.length.leb128,
    wasm.local$get, ...idx,
    wasm.i32$sub,
    wasm.call, ...substring.func_idx_leb128
  );
});

// todo: test that end < start
const substring_until = func_builder(function (func) {
  const str = func.param(wasm.i32),
        start = func.param(wasm.i32),
        end = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.local$get, ...start,
    wasm.local$get, ...end,
    wasm.local$get, ...start,
    wasm.i32$sub,
    wasm.call, ...substring.func_idx_leb128
  );
});

const new_string = func_builder(function (func) {
  const len = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    // ceiling of len/4
    wasm.local$get, ...len,
    wasm.i32$const, 4,
    wasm.call, ...i32_div_ceil.func_idx_leb128,
    wasm.call, ...array_by_length.func_idx_leb128,
    wasm.local$get, ...len,
    wasm.call, ...types.String.constr.leb128,
  );
});

// todo: confirm str2 is string
const concat_str = func_builder(function (func) {
  const str1 = func.param(wasm.i32),
        str2 = func.param(wasm.i32),
        len1 = func.local(wasm.i32),
        len2 = func.local(wasm.i32),
        arr = func.local(wasm.i32),
        out = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...str1,
    wasm.call, ...types.String.fields.length.leb128,
    wasm.local$tee, ...len1,
    wasm.local$get, ...str2,
    wasm.call, ...types.String.fields.length.leb128,
    wasm.local$tee, ...len2,
    wasm.call, ...safe_add_i32.func_idx_leb128,
    wasm.call, ...new_string.func_idx_leb128,
    wasm.local$tee, ...out,
    wasm.call, ...types.String.fields.arr.leb128,
    wasm.call, ...types.Array.fields.arr.leb128,
    wasm.local$tee, ...arr,
    wasm.local$get, ...str1,
    wasm.call, ...types.String.fields.arr.leb128,
    wasm.call, ...types.Array.fields.arr.leb128,
    wasm.local$get, ...len1,
    wasm.mem$prefix,
    wasm.mem$copy, 0, 0,
    wasm.local$get, ...arr,
    wasm.local$get, ...len1,
    wasm.i32$add,
    wasm.local$get, ...str2,
    wasm.call, ...types.String.fields.arr.leb128,
    wasm.call, ...types.Array.fields.arr.leb128,
    wasm.local$get, ...len2,
    wasm.mem$prefix,
    wasm.mem$copy, 0, 0,
    wasm.local$get, ...out
  );
});

/*------*\
|        |
| Object |
|        |
\*------*/

impl_free(types.Object, function (func) {
  const obj = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...obj,
    wasm.call, ...types.Object.fields.address.leb128,
    wasm.call, ...free_ref.func_idx_leb128,
    wasm.i32$const, 1
  );
});

/*------------*\
|              |
| coll methods |
|              |
\*------------*/

const get = pre_new_method(null, 3),
      assoc = pre_new_method("assoc", 3),
      conj = pre_new_method("conj", 2),
      nth = pre_new_method("nth", 3),
      first = pre_new_method("first", 1),
      rest = pre_new_method("rest", 1);

/*------*\
|        |
| Vector |
|        |
\*------*/

const empty_vector = comp.Vector(0, 5, empty_refs_array, empty_refs_array);

impl_free(types.Vector, function (func) {
  const vec = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.count.leb128,
    wasm.if, wasm.i32,
      wasm.local$get, ...vec,
      wasm.call, ...types.Vector.fields.root.leb128,
      wasm.call, ...free.func_idx_leb128,
      wasm.local$get, ...vec,
      wasm.call, ...types.Vector.fields.tail.leb128,
      wasm.call, ...free.func_idx_leb128,
      wasm.i32$const, 1,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

const new_path = func_builder(function (func) {
  const level = func.param(wasm.i32),
        node = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    // new_path is called when a new vector is being created
    // the tail (node) will now be referenced by two vectors
    wasm.local$get, ...node,
    wasm.call, ...inc_refs.func_idx_leb128,
    wasm.drop,
    wasm.loop, wasm.i32,
      wasm.local$get, ...level,
      wasm.if, wasm.i32,
        wasm.i32$const, 1,
        wasm.call, ...refs_array_by_length.func_idx_leb128,
        wasm.i32$const, 0,
        wasm.local$get, ...node,
        // new nodes are only referenced here so don't need inc_refs
        wasm.call, ...refs_array_set_no_inc.func_idx_leb128,
        wasm.local$set, ...node,
        wasm.local$get, ...level,
        wasm.i32$const, 5,
        wasm.i32$sub,
        wasm.local$set, ...level,
        wasm.br, 1,
      wasm.else,
        wasm.local$get, ...node,
      wasm.end,
    wasm.end
  );
});

const push_tail = func_builder(function (func) {
  const vec = func.param(wasm.i32),
        level = func.param(wasm.i32),
        parent = func.param(wasm.i32),
        tail = func.param(wasm.i32),
        arr = func.local(wasm.i32),
        subidx = func.local(wasm.i32),
        child = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    // first two args to refs_array_copy
    wasm.local$get, ...parent,
    wasm.i32$const, 0,

    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.count.leb128,
    wasm.i32$const, 1,
    wasm.i32$sub,
    wasm.local$get, ...level,
    wasm.i32$shr_u,
    wasm.i32$const, 31,
    wasm.i32$and,
    wasm.local$tee, ...subidx,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.call, ...refs_array_by_length.func_idx_leb128,

    // last two args to refs_array_copy
    wasm.i32$const, 0,
    wasm.local$get, ...parent,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.call, ...types.Array.fields.length.leb128,

    // inc_refs because contents will be shared
    wasm.call, ...refs_array_copy.func_idx_leb128,
    wasm.local$tee, ...arr,

    // second arg to refs_array_set_no_inc
    wasm.local$get, ...subidx,

    wasm.i32$const, 5,
    wasm.local$get, ...level,
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.local$get, ...tail,
      // tail is now shared
      wasm.call, ...inc_refs.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...level,
      wasm.i32$const, 5,
      wasm.i32$sub,
      wasm.local$set, ...level,
      wasm.local$get, ...arr,
      wasm.local$get, ...subidx,
      wasm.call, ...refs_array_get.func_idx_leb128,
      wasm.local$tee, ...child,
      wasm.if, wasm.i32,
        wasm.local$get, ...vec,
        wasm.local$get, ...level,
        wasm.local$get, ...child,
        wasm.local$get, ...tail,
        // no inc_refs because func returns new array
        // contents of new array are inc_ref'd above
        wasm.call, ...func.func_idx_leb128,
      wasm.else,
        wasm.local$get, ...level,
        wasm.local$get, ...tail,
        // tail is inc_ref'd inside new_path
        wasm.call, ...new_path.func_idx_leb128,
      wasm.end,
    wasm.end,

    wasm.call, ...refs_array_set_no_inc.func_idx_leb128
  );
});

const tail_off = func_builder(function (func) {
  const vec = func.param(wasm.i32),
        cnt = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.count.leb128,
    wasm.local$tee, ...cnt,
    wasm.i32$const, 32,
    wasm.i32$lt_u,
    wasm.if, wasm.i32,
      wasm.i32$const, 0,
    wasm.else,
      wasm.local$get, ...cnt,
      wasm.i32$const, 1,
      wasm.i32$sub,
      wasm.i32$const, 5,
      wasm.i32$shr_u,
      wasm.i32$const, 5,
      wasm.i32$shl,
    wasm.end
  );
});

conj.implement(types.Vector, function (func) {
  const vec = func.param(wasm.i32),
        val = func.param(wasm.i32),
        cnt = func.local(wasm.i32),
        shift = func.local(wasm.i32),
        root = func.local(wasm.i32),
        len = func.local(wasm.i32),
        tail = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.tail.leb128,
    wasm.local$set, ...tail,
    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.shift.leb128,
    wasm.local$set, ...shift,
    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.root.leb128,
    wasm.local$set, ...root,
    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.count.leb128,
    wasm.local$tee, ...cnt,
    wasm.local$get, ...vec,
    wasm.call, ...tail_off.func_idx_leb128,
    wasm.i32$sub,
    wasm.i32$const, 32,
    wasm.i32$lt_u,
    wasm.if, wasm.void,
      wasm.local$get, ...tail,
      wasm.i32$const, 0,
      wasm.local$get, ...tail,
      wasm.call, ...types.RefsArray.fields.arr.leb128,
      wasm.call, ...types.Array.fields.length.leb128,
      wasm.local$tee, ...len,
      wasm.i32$const, 1,
      wasm.i32$add,
      wasm.call, ...refs_array_by_length.func_idx_leb128,
      wasm.i32$const, 0,
      wasm.local$get, ...len,
      // inc_refs needed for shared contents of tails
      wasm.call, ...refs_array_copy.func_idx_leb128,
      wasm.local$get, ...len,
      wasm.local$get, ...val,
      wasm.call, ...refs_array_set.func_idx_leb128,
      wasm.local$set, ...tail,
      // root is unchanged, so it will be shared
      wasm.local$get, ...root,
      wasm.call, ...inc_refs.func_idx_leb128,
      wasm.drop,
    wasm.else,
      wasm.local$get, ...cnt,
      wasm.i32$const, 5,
      wasm.i32$shr_u,
      wasm.i32$const, 1,
      wasm.local$get, ...shift,
      wasm.i32$shl,
      wasm.i32$gt_u,
      wasm.if, wasm.void,
        wasm.i32$const, 2,
        wasm.call, ...refs_array_by_length.func_idx_leb128,
        wasm.i32$const, 0,
        wasm.local$get, ...root,
        // root is now shared, so inc_refs needed
        wasm.call, ...refs_array_set.func_idx_leb128,
        wasm.i32$const, 1,
        wasm.local$get, ...shift,
        wasm.local$get, ...tail,
        // tail is inc_ref'd in new_path
        wasm.call, ...new_path.func_idx_leb128,
        // new_path is new, so no inc_refs
        wasm.call, ...refs_array_set_no_inc.func_idx_leb128,
        wasm.local$set, ...root,
        wasm.local$get, ...shift,
        wasm.i32$const, 5,
        wasm.i32$add,
        wasm.local$set, ...shift,
      wasm.else,
        wasm.local$get, ...vec,
        wasm.local$get, ...shift,
        wasm.local$get, ...root,
        wasm.local$get, ...tail,
        // push_tail copies contents of root into new array,
        // so root will not be shared
        wasm.call, ...push_tail.func_idx_leb128,
        wasm.local$set, ...root,
      wasm.end,
      wasm.i32$const, 1,
      wasm.call, ...refs_array_by_length.func_idx_leb128,
      wasm.i32$const, 0,
      wasm.local$get, ...val,
      wasm.call, ...refs_array_set.func_idx_leb128,
      wasm.local$set, ...tail,
    wasm.end,
    wasm.local$get, ...cnt,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.local$get, ...shift,
    wasm.local$get, ...root,
    wasm.local$get, ...tail,
    wasm.call, ...types.Vector.constr.leb128
  );
});

const unchecked_array_for = func_builder(function (func) {
  const vec = func.param(wasm.i32),
        n = func.param(wasm.i32),
        node = func.local(wasm.i32),
        level = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...n,
    wasm.local$get, ...vec,
    wasm.call, ...tail_off.func_idx_leb128,
    wasm.i32$ge_u,
    wasm.if, wasm.i32,
      wasm.local$get, ...vec,
      wasm.call, ...types.Vector.fields.tail.leb128,
    wasm.else,
      wasm.local$get, ...vec,
      wasm.call, ...types.Vector.fields.root.leb128,
      wasm.local$set, ...node,
      wasm.local$get, ...vec,
      wasm.call, ...types.Vector.fields.shift.leb128,
      wasm.local$set, ...level,
      wasm.loop, wasm.i32,
        wasm.local$get, ...level,
        wasm.if, wasm.i32,
          wasm.local$get, ...node,
          wasm.local$get, ...n,
          wasm.local$get, ...level,
          wasm.i32$shr_u,
          wasm.i32$const, ...leb128(0x01f),
          wasm.i32$and,
          wasm.call, ...refs_array_get.func_idx_leb128,
          wasm.local$set, ...node,
          wasm.local$get, ...level,
          wasm.i32$const, 5,
          wasm.i32$sub,
          wasm.local$set, ...level,
          wasm.br, 1,
        wasm.else,
          wasm.local$get, ...node,
        wasm.end,
      wasm.end,
    wasm.end
  );
});

nth.implement(types.Vector, function (func) {
  const vec = func.param(wasm.i32),
        n = func.param(wasm.i32),
        not_found = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...n,
    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.count.leb128,
    wasm.i32$lt_u,
    wasm.if, wasm.i32,
      wasm.local$get, ...vec,
      wasm.local$get, ...n,
      wasm.call, ...unchecked_array_for.func_idx_leb128,
      wasm.local$get, ...n,
      wasm.i32$const, ...leb128(0x01f),
      wasm.i32$and,
      wasm.call, ...refs_array_get.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...not_found,
    wasm.end
  );
});

const do_assoc = func_builder(function (func) {
  const vec = func.param(wasm.i32),
        level = func.param(wasm.i32),
        node = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        val = func.param(wasm.i32),
        subidx = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...node,
    // inc_refs for shared contents of arrays
    wasm.call, ...refs_array_clone.func_idx_leb128,
    wasm.local$set, ...node,
    wasm.local$get, ...level,
    wasm.if, wasm.i32,
      wasm.local$get, ...node,

      wasm.local$get, ...idx,
      wasm.local$get, ...level,
      wasm.i32$shr_u,
      wasm.i32$const, ...leb128(0x01f),
      wasm.i32$and,
      wasm.local$tee, ...subidx,

      wasm.local$get, ...vec,
      wasm.local$get, ...level,
      wasm.i32$const, 5,
      wasm.i32$sub,
      wasm.local$get, ...node,
      wasm.local$get, ...subidx,
      wasm.call, ...refs_array_get.func_idx_leb128,
      wasm.local$get, ...idx,
      wasm.local$get, ...val,
      wasm.call, ...func.func_idx_leb128,

      // recursively created node is new, so no inc_refs
      wasm.call, ...refs_array_set_no_inc.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...node,
      wasm.local$get, ...idx,
      wasm.i32$const, ...leb128(0x01f),
      wasm.i32$and,
      wasm.local$get, ...val,
      wasm.call, ...refs_array_set.func_idx_leb128,
    wasm.end
  );
});

// todo: verify that n <= vec count
assoc.implement(types.Vector, function (func) {
  const vec = func.param(wasm.i32),
        n = func.param(wasm.i32),
        val = func.param(wasm.i32),
        cnt = func.local(wasm.i32),
        shift = func.local(wasm.i32),
        root = func.local(wasm.i32),
        tail = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.count.leb128,
    wasm.local$tee, ...cnt,
    wasm.local$get, ...n,
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.local$get, ...vec,
      wasm.local$get, ...val,
      wasm.call, ...conj.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...vec,
      wasm.call, ...types.Vector.fields.shift.leb128,
      wasm.local$set, ...shift,
      wasm.local$get, ...vec,
      wasm.call, ...types.Vector.fields.root.leb128,
      wasm.local$set, ...root,
      wasm.local$get, ...vec,
      wasm.call, ...types.Vector.fields.tail.leb128,
      wasm.local$set, ...tail,
      wasm.local$get, ...vec,
      wasm.call, ...tail_off.func_idx_leb128,
      wasm.local$get, ...n,
      wasm.i32$le_u,
      wasm.if, wasm.i32,
        wasm.local$get, ...cnt,
        wasm.local$get, ...shift,
        wasm.local$get, ...root,
        // root is now shared
        wasm.call, ...inc_refs.func_idx_leb128,
        wasm.local$get, ...tail,
        wasm.call, ...refs_array_clone.func_idx_leb128,
        wasm.local$get, ...n,
        wasm.i32$const, ...leb128(0x01f),
        wasm.i32$and,
        wasm.local$get, ...val,
        wasm.call, ...refs_array_set.func_idx_leb128,
        wasm.call, ...types.Vector.constr.leb128,
      wasm.else,
        wasm.local$get, ...cnt,
        wasm.local$get, ...shift,
        wasm.local$get, ...vec,
        wasm.local$get, ...shift,
        wasm.local$get, ...root,
        wasm.local$get, ...n,
        wasm.local$get, ...val,
        wasm.call, ...do_assoc.func_idx_leb128,
        wasm.local$get, ...tail,
        // tail is now shared
        wasm.call, ...inc_refs.func_idx_leb128,
        wasm.call, ...types.Vector.constr.leb128,
      wasm.end,
    wasm.end
  );
});

const vector_from_array = func_builder(function (func) {
  const arr = func.param(wasm.i32),
        cnt = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...arr,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.call, ...types.Array.fields.length.leb128,
    wasm.local$tee, ...cnt,
    wasm.i32$const, 32,
    wasm.i32$le_u,
    wasm.if, wasm.i32,
      wasm.local$get, ...cnt,
      wasm.i32$const, 5,
      wasm.i32$const, ...leb128(empty_refs_array),
      wasm.local$get, ...arr,
      wasm.call, ...types.Vector.constr.leb128,
    wasm.else,
      // will need to conj each element until last 32
      wasm.i32$const, 0,
    wasm.end
  );
});

/*---------*\
|           |
| VectorSeq |
|           |
\*---------*/

const empty_vector_seq = comp.VectorSeq(0, empty_vector, 0);

const is_seq = pre_new_method(null, 1, 0, 0, "i32", function (func) {
  func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.i32$const, 0);
});

is_seq.implement(types.VectorSeq, function (func) {
  func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.i32$const, 1);
});

conj.implement(types.VectorSeq, function (func) {
  const seq = func.param(wasm.i32),
        val = func.param(wasm.i32),
        vec = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...seq,
    wasm.call, ...types.VectorSeq.fields.vec.leb128,
    wasm.local$get, ...val,
    wasm.call, ...conj.func_idx_leb128,
    wasm.local$tee, ...vec,
    // no inc_refs because the new vec is never meant to
    // be referenced outside the seq
    wasm.call, ...types.Vector.fields.count.leb128,
    wasm.local$get, ...vec,
    wasm.local$get, ...seq,
    wasm.call, ...types.VectorSeq.fields.offset.leb128,
    wasm.call, ...types.VectorSeq.constr.leb128
  );
});

nth.implement(types.VectorSeq, function (func) {
  const seq = func.param(wasm.i32),
        n = func.param(wasm.i32),
        not_found = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...seq,
    wasm.call, ...types.VectorSeq.fields.vec.leb128,
    wasm.local$get, ...seq,
    wasm.call, ...types.VectorSeq.fields.offset.leb128,
    wasm.local$get, ...n,
    wasm.i32$add,
    wasm.local$get, ...not_found,
    wasm.call, ...nth.func_idx_leb128
  );
});

first.implement(types.VectorSeq, function (func) {
  const seq = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...seq,
    wasm.i32$const, 0,
    wasm.i32$const, nil,
    wasm.call, ...nth.func_idx_leb128
  );
});

rest.implement(types.VectorSeq, function (func) {
  const seq = func.param(wasm.i32),
        cnt = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...seq,
    wasm.call, ...types.VectorSeq.fields.count.leb128,
    wasm.local$tee, ...cnt,
    wasm.i32$const, 1,
    wasm.i32$gt_u,
    wasm.if, wasm.i32,
      wasm.local$get, ...cnt,
      wasm.i32$const, 1,
      wasm.i32$sub,
      wasm.local$get, ...seq,
      wasm.call, ...types.VectorSeq.fields.vec.leb128,
      wasm.call, ...inc_refs.func_idx_leb128,
      wasm.local$get, ...seq,
      wasm.call, ...types.VectorSeq.fields.offset.leb128,
      wasm.i32$const, 1,
      wasm.i32$add,
      wasm.call, ...types.VectorSeq.constr.leb128,
    wasm.else,
      wasm.i32$const, ...leb128(empty_vector_seq),
    wasm.end
  );
});

impl_free(types.VectorSeq, function (func) {
  const seq = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...seq,
    wasm.call, ...types.VectorSeq.fields.count.leb128,
    wasm.if, wasm.i32,
      wasm.local$get, ...seq,
      wasm.call, ...types.VectorSeq.fields.vec.leb128,
      wasm.call, ...free.func_idx_leb128,
      wasm.i32$const, 1,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

const vector_seq_from_array = func_builder(function (func) {
  const arr = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...arr,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.call, ...types.Array.fields.length.leb128,
    wasm.local$get, ...arr,
    wasm.call, ...vector_from_array.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...types.VectorSeq.constr.leb128
  );
});

/*----*\
|      |
| hash |
|      |
\*----*/

// https://github.com/hideo55/node-murmurhash3/blob/master/src/MurmurHash3.cpp
// https://github.com/scala/scala/blob/2.13.x/src/library/scala/util/hashing/MurmurHash3.scala

const m3_mix_k = func_builder(function (func) {
  const h = func.param(wasm.i32),
        k = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...h,
    wasm.local$get, ...k,
    wasm.i32$const, ...leb128(0xcc9e2d51),
    wasm.i32$mul,
    wasm.i32$const, 15,
    wasm.i32$rotl,
    wasm.i32$const, ...leb128(0x1b873593),
    wasm.i32$mul,
    wasm.i32$xor,
  );
});

const m3_mix_h = func_builder(function (func) {
  const h = func.param(wasm.i32),
        k = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...h,
    wasm.local$get, ...k,
    wasm.call, ...m3_mix_k.func_idx_leb128,
    wasm.i32$const, 13,
    wasm.i32$rotl,
    wasm.i32$const, 5,
    wasm.i32$mul,
    wasm.i32$const, ...leb128(0xe6546b64),
    wasm.i32$add
  );
});

const m3_fmix = func_builder(function (func) {
  const h = func.param(wasm.i32),
        len = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...h,
    wasm.local$get, ...len,
    wasm.i32$xor,
    wasm.local$tee, ...h,
    wasm.local$get, ...h,
    wasm.i32$const, 16,
    wasm.i32$shr_u,
    wasm.i32$xor,
    wasm.i32$const, ...leb128(0x85ebca6b),
    wasm.i32$mul,
    wasm.local$tee, ...h,
    wasm.local$get, ...h,
    wasm.i32$const, 13,
    wasm.i32$shr_u,
    wasm.i32$xor,
    wasm.i32$const, ...leb128(0xc2b2ae35),
    wasm.i32$mul,
    wasm.local$tee, ...h,
    wasm.local$get, ...h,
    wasm.i32$const, 16,
    wasm.i32$shr_u,
    wasm.i32$xor
  );
});

/*
const hash_combine = func_builder(function (func) {
  const seed = func.param(wasm.i32),
        hash = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...seed,
    wasm.local$get, ...seed,
    wasm.i32$const, 2,
    wasm.i32$shr_s,
    wasm.local$get, ...seed,
    wasm.i32$const, 6,
    wasm.i32$shl,
    wasm.i32$add,
    wasm.i32$const, ...leb128(0x9e3779b9),
    wasm.i32$add,
    wasm.local$get, ...hash,
    wasm.i32$add,
    wasm.i32$xor
  );
});
*/

// todo: do remaining bytes
const hash_bytes = func_builder(function (func) {
  const arr = func.param(wasm.i32),
        len = func.param(wasm.i32),
        cnt = func.local(wasm.i32),
        idx = func.local(wasm.i32),
        hsh = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...len,
    wasm.i32$const, 2,
    wasm.i32$shr_u,
    wasm.local$set, ...cnt,
    wasm.loop, wasm.void,
      wasm.local$get, ...idx,
      wasm.local$get, ...cnt,
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        wasm.local$get, ...hsh,
        wasm.local$get, ...arr,
        wasm.local$get, ...idx,
        wasm.call, ...array_get_i32.func_idx_leb128,
        wasm.call, ...m3_mix_h.func_idx_leb128,
        wasm.local$set, ...hsh,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$set, ...idx,
        wasm.br, 1,
      wasm.end,
    wasm.end,
    wasm.local$get, ...hsh,
    wasm.local$get, ...len,
    // wasm.i32$const, 2,
    // wasm.i32$shl,
    wasm.call, ...m3_fmix.func_idx_leb128
  );
});

const hash_id = function (func) {
  const x = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.local$get, ...x);
}

const hash = pre_new_method(null, 1, 0, 0, "i32", hash_id);

hash.implement(types.Nil, hash_id);

hash.implement(types.True, function (func) {
  func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.i32$const, ...leb128(1231));
});

hash.implement(types.False, function (func) {
  func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.i32$const, ...leb128(1237));
});

hash.implement(types.Int, function (func) {
  const i = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...i,
    wasm.call, ...types.Int.fields.value.leb128,
    wasm.i32$wrap_i64
  );
});

hash.implement(types.Float, function (func) {
  const f = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...f,
    wasm.call, ...types.Float.fields.value.leb128,
    wasm.i32$trunc_f64_s
  );
});
//  todo: handle infinity
//  (case o
//    ##Inf
//    2146435072
//    ##-Inf
//    -1048576
//    2146959360)

function caching_hash (...ops) {
  return function (func) {
    const val = func.param(wasm.i32),
          slot = func.local(wasm.i32),
          h = func.local(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...val,
      wasm.i32$const, ...leb128(types.Symbol.fields.hash.offset),
      wasm.i32$add,
      wasm.local$tee, ...slot,
      wasm.atomic$prefix,
      wasm.i32$atomic$load, 2, 0,
      wasm.local$tee, ...h,
      wasm.if, wasm.i32,
        wasm.local$get, ...h,
      wasm.else,
        ...ops,
        wasm.local$tee, ...h,
        wasm.local$get, ...slot,
        wasm.local$get, ...h,
        wasm.atomic$prefix,
        wasm.i32$atomic$store, 2, 0,
      wasm.end
    );
  };
}

const hash_string = caching_hash(
  wasm.local$get, 0,
  wasm.call, ...types.String.fields.arr.leb128,
  wasm.local$get, 0,
  wasm.call, ...types.String.fields.length.leb128,
  wasm.call, ...hash_bytes.func_idx_leb128
);

hash.implement(types.String, hash_string);

// based on how Scala handles Tuple2
function impl_hash_symkw (which) {
  hash.implement(which, caching_hash(
    wasm.i32$const, 0,
    wasm.i32$const, ...leb128(which.type_num),
    wasm.call, ...m3_mix_h.func_idx_leb128,
    wasm.local$get, 0,
    wasm.call, ...which.fields.namespace.leb128,
    wasm.call, ...hash.func_idx_leb128,
    wasm.call, ...m3_mix_h.func_idx_leb128,
    wasm.local$get, 0,
    wasm.call, ...which.fields.name.leb128,
    wasm.call, ...hash.func_idx_leb128,
    wasm.call, ...m3_mix_h.func_idx_leb128,
    wasm.i32$const, 2,
    wasm.call, ...m3_fmix.func_idx_leb128
  ));
}

impl_hash_symkw(types.Symbol);
impl_hash_symkw(types.Keyword);

/*--*\
|    |
| eq |
|    |
\*--*/

const equiv = pre_new_method(null, 2, 0, 0, "i32", function (func) {
  const a = func.param(wasm.i32),
        b = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.i32$const, 0);
});

const string_matches = func_builder(function (func) {
  const str1 = func.param(wasm.i32),
        str2 = func.param(wasm.i32),
        len = func.local(wasm.i32),
        idx = func.local(wasm.i32),
        cnt = func.local(wasm.i32),
		c = func.local(wasm.i32),
        out = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...str1,
    wasm.call, ...types.String.fields.arr.leb128,
    wasm.local$set, ...str1,
    wasm.local$get, ...str2,
    wasm.call, ...types.String.fields.length.leb128,
    wasm.local$tee, ...len,
    // divide by 8 because len is in bytes, but we will compare i64s
    wasm.i32$const, 3,
    wasm.i32$shr_u,
    wasm.local$set, ...cnt,
    wasm.local$get, ...str2,
    wasm.call, ...types.String.fields.arr.leb128,
    wasm.local$set, ...str2,
    wasm.i32$const, 1,
    wasm.local$set, ...out,
    wasm.loop, wasm.void,
      wasm.local$get, ...idx,
      wasm.local$get, ...cnt,
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        wasm.local$get, ...str1,
        wasm.local$get, ...idx,
        wasm.call, ...array_get_i64.func_idx_leb128,
        wasm.local$get, ...str2,
        wasm.local$get, ...idx,
        wasm.call, ...array_get_i64.func_idx_leb128,
        wasm.i64$eq,
        wasm.if, wasm.void,
          wasm.local$get, ...idx,
          wasm.i32$const, 1,
          wasm.i32$add,
          wasm.local$set, ...idx,
          wasm.br, 2,
        wasm.else,
          wasm.i32$const, 0,
          wasm.local$set, ...out,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.local$get, ...out,
    wasm.if, wasm.void,
      wasm.local$get, ...idx,
      wasm.i32$const, 3,
      wasm.i32$shl,
      wasm.local$set, ...idx,
      wasm.loop, wasm.void,
        wasm.local$get, ...idx,
        wasm.local$get, ...len,
        wasm.i32$lt_u,
        wasm.if, wasm.void,
          wasm.local$get, ...str1,
          wasm.local$get, ...idx,
          wasm.call, ...array_get_i8.func_idx_leb128,
          wasm.local$get, ...str2,
          wasm.local$get, ...idx,
          wasm.call, ...array_get_i8.func_idx_leb128,
          wasm.i32$eq,
          wasm.if, wasm.void,
            wasm.local$get, ...idx,
            wasm.i32$const, 1,
            wasm.i32$add,
            wasm.local$set, ...idx,
            wasm.br, 2,
          wasm.else,
            wasm.i32$const, 0,
            wasm.local$set, ...out,
          wasm.end,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.local$get, ...out
  );
});

const string_matches_from = func_builder(function (func) {
  const str = func.param(wasm.i32),
        sbstr = func.param(wasm.i32),
        from = func.param(wasm.i32),
        len = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.call, ...string_length.func_idx_leb128,
    wasm.local$get, ...from,
    wasm.i32$sub,
    wasm.local$get, ...sbstr,
    wasm.call, ...string_length.func_idx_leb128,
    wasm.local$tee, ...len,
    wasm.i32$ge_u,
    wasm.if, wasm.i32,
      wasm.local$get, ...str,
      wasm.local$get, ...from,
      wasm.local$get, ...len,
      wasm.call, ...substring.func_idx_leb128,
      wasm.local$tee, ...str,
      wasm.local$get, ...sbstr,
      wasm.local$get, ...from,
      wasm.local$get, ...len,
      wasm.call, ...get_string_chunk.func_idx_leb128,
      wasm.call, ...string_matches.func_idx_leb128,
      wasm.local$get, ...str,
      wasm.call, ...free.func_idx_leb128,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

// todo: make sure b is also string in comp
const string_equiv = func_builder(function (func) {
  const a = func.param(wasm.i32),
        b = func.param(wasm.i32),
        len = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...a,
    wasm.call, ...string_length.func_idx_leb128,
    wasm.local$tee, ...len,
    wasm.local$get, ...b,
    wasm.call, ...string_length.func_idx_leb128,
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.local$get, ...a,
      wasm.i32$const, 0,
      wasm.local$get, ...len,
      wasm.call, ...get_string_chunk.func_idx_leb128,
      wasm.local$get, ...b,
      wasm.i32$const, 0,
      wasm.local$get, ...len,
      wasm.call, ...get_string_chunk.func_idx_leb128,
      wasm.call, ...string_matches.func_idx_leb128,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

function hashed_equiv (equiv) {
  return function (func) {
    const a = func.param(wasm.i32),
          b = func.param(wasm.i32),
          ha = func.local(wasm.i32),
          hb = func.local(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...a,
      wasm.i32$const, 8,
      wasm.i32$add,
      wasm.atomic$prefix,
      wasm.i32$atomic$load, 2, 0,
      wasm.local$tee, ...ha,
      wasm.local$get, ...b,
      wasm.i32$const, 8,
      wasm.i32$add,
      wasm.atomic$prefix,
      wasm.i32$atomic$load, 2, 0,
      wasm.local$tee, ...hb,
      wasm.i32$and,
      wasm.if, wasm.i32,
        wasm.local$get, ...ha,
        wasm.local$get, ...hb,
        wasm.i32$eq,
      wasm.else,
        wasm.i32$const, 1,
      wasm.end,
      wasm.if, wasm.i32,
        wasm.local$get, ...a,
        wasm.local$get, ...b,
        wasm.call, ...equiv.func_idx_leb128,
      wasm.else,
        wasm.i32$const, 0,
      wasm.end
    );
  };
}

equiv.implement(types.String, hashed_equiv(string_equiv));
equiv.implement(types.File, hashed_equiv(string_equiv));

function equiv_by_field(type, field, op) {
  equiv.implement(type, function (func) {
    const a = func.param(wasm.i32),
          b = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...a,
      wasm.call, ...type.fields[field].leb128,
      wasm.local$get, ...b,
      wasm.call, ...type.fields[field].leb128,
      op
    );
  });
}

equiv_by_field(types.Int, "value", wasm.i64$eq);
equiv_by_field(types.Float, "value", wasm.f64$eq);

const eq = func_builder(function (func) {
  const a = func.param(wasm.i32),
        b = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...a,
    wasm.local$get, ...b,
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.i32$const, 1,
    wasm.else,
      wasm.local$get, ...a,
      wasm.local$get, ...b,
      wasm.call, ...equiv.func_idx_leb128,
    wasm.end
  );
});

/*-------*\
|         |
| HashMap |
|         |
\*-------*/

const empty_bitmap_indexed_node = comp.BitmapIndexedNode(0, empty_refs_array),
      empty_hash_map = comp.HashMap(0, empty_bitmap_indexed_node, 0, 0);

const inode_assoc = pre_new_method(null, 6),
      inode_lookup = pre_new_method(null, 5);

impl_free(types.BitmapIndexedNode, function (func) {
  const node = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...node,
    wasm.call, ...types.BitmapIndexedNode.fields.arr.leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.i32$const, 1
  );
});

impl_free(types.ArrayNode, function (func) {
  const node = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...node,
    wasm.call, ...types.ArrayNode.fields.arr.leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.i32$const, 1
  );
});

impl_free(types.HashCollisionNode, function (func) {
  const node = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...node,
    wasm.call, ...types.HashCollisionNode.fields.arr.leb128,
    wasm.call, ...free.func_idx_leb128,
    wasm.i32$const, 1
  );
});

impl_free(types.HashMap, function (func) {
  const map = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...map,
    wasm.call, ...types.HashMap.fields.count.leb128,
    wasm.if, wasm.i32,
      wasm.local$get, ...map,
      wasm.call, ...types.HashMap.fields.root.leb128,
      wasm.call, ...free.func_idx_leb128,
      wasm.local$get, ...map,
      wasm.call, ...types.HashMap.fields.nil_val.leb128,
      wasm.call, ...free.func_idx_leb128,
      wasm.i32$const, 1,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

const mask = func_builder(function (func) {
  const hash = func.param(wasm.i32),
        shift = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...hash,
    wasm.local$get, ...shift,
    wasm.i32$shr_u,
    wasm.i32$const, 31,
    wasm.i32$and
  );
});

const bitmap_indexed_node_index = func_builder(function (func) {
  const bitmap = func.param(wasm.i32),
        bit = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...bitmap,
    wasm.local$get, ...bit,
    wasm.i32$const, 1,
    wasm.i32$sub,
    wasm.i32$and,
    wasm.i32$popcnt
  );
});

const bitpos = func_builder(function (func) {
  const hash = func.param(wasm.i32),
        shift = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.i32$const, 1,
    wasm.local$get, ...hash,
    wasm.local$get, ...shift,
    wasm.call, ...mask.func_idx_leb128,
    wasm.i32$shl
  );
});

const create_node = func_builder(function (func) {
  const shift = func.param(wasm.i32),
        key1 = func.param(wasm.i32),
        val1 = func.param(wasm.i32),
        key2hash = func.param(wasm.i32),
        key2 = func.param(wasm.i32),
        val2 = func.param(wasm.i32),
        key1hash = func.local(wasm.i32),
        added_leaf = func.local(wasm.i32),
        tmp = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...key1,
    wasm.call, ...hash.func_idx_leb128,
    wasm.local$tee, ...key1hash,
    wasm.local$get, ...key2hash,
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.local$get, ...key1hash,
      wasm.i32$const, 2,
      wasm.i32$const, 4,
      wasm.call, ...refs_array_by_length.func_idx_leb128,
      wasm.i32$const, 0,
      wasm.local$get, ...key1,
      wasm.call, ...refs_array_set.func_idx_leb128,
      wasm.i32$const, 1,
      wasm.local$get, ...val1,
      wasm.call, ...refs_array_set.func_idx_leb128,
      wasm.i32$const, 2,
      wasm.local$get, ...key2,
      wasm.call, ...refs_array_set.func_idx_leb128,
      wasm.i32$const, 3,
      wasm.local$get, ...val2,
      wasm.call, ...refs_array_set.func_idx_leb128,
      wasm.call, ...types.HashCollisionNode.constr.leb128,
    wasm.else,
      wasm.i32$const, 4,
      wasm.call, ...alloc.func_idx_leb128,
      wasm.local$set, ...added_leaf,
      wasm.i32$const, ...leb128(empty_bitmap_indexed_node),
      wasm.local$get, ...shift,
      wasm.local$get, ...key1hash,
      wasm.local$get, ...key1,
      wasm.local$get, ...val1,
      wasm.local$get, ...added_leaf,
      wasm.call, ...inode_assoc.func_idx_leb128,
      wasm.local$tee, ...tmp,
      wasm.local$get, ...shift,
      wasm.local$get, ...key2hash,
      wasm.local$get, ...key2,
      wasm.local$get, ...val2,
      wasm.local$get, ...added_leaf,
      wasm.call, ...inode_assoc.func_idx_leb128,
      wasm.local$get, ...added_leaf,
      wasm.i32$const, 4,
      wasm.call, ...free_mem.func_idx_leb128,
      wasm.local$get, ...tmp,
      wasm.call, ...free.func_idx_leb128,
    wasm.end
  );
});

inode_assoc.implement(types.BitmapIndexedNode, function (func) {
  const inode = func.param(wasm.i32),
        shift = func.param(wasm.i32),
        hsh = func.param(wasm.i32),
        key = func.param(wasm.i32),
        val = func.param(wasm.i32),
        added_leaf = func.param(wasm.i32),
        bitmap = func.local(wasm.i32),
        arr = func.local(wasm.i32),
        bit = func.local(wasm.i32),
        idx = func.local(wasm.i32),
        key_idx = func.local(wasm.i32),
        val_idx = func.local(wasm.i32),
        new_shift = func.local(wasm.i32),
        new_arr = func.local(wasm.i32),
        key_or_nil = func.local(wasm.i32),
        val_or_node = func.local(wasm.i32),
        new_node = func.local(wasm.i32),
        n = func.local(wasm.i32),
        jdx = func.local(wasm.i32),
        i = func.local(wasm.i32),
        j = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...inode,
    wasm.call, ...types.BitmapIndexedNode.fields.arr.leb128,
    wasm.local$set, ...arr,
    wasm.local$get, ...inode,
    wasm.call, ...types.BitmapIndexedNode.fields.bitmap.leb128,
    wasm.local$tee, ...bitmap,
    wasm.local$get, ...hsh,
    wasm.local$get, ...shift,
    wasm.call, ...bitpos.func_idx_leb128,
    wasm.local$tee, ...bit,
    wasm.call, ...bitmap_indexed_node_index.func_idx_leb128,
    wasm.local$tee, ...idx,
    wasm.i32$const, 2,
    wasm.i32$mul,
    wasm.local$tee, ...key_idx,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.local$set, ...val_idx,
    wasm.local$get, ...shift,
    wasm.i32$const, 5,
    wasm.i32$add,
    wasm.local$set, ...new_shift,
    wasm.local$get, ...bitmap,
    wasm.local$get, ...bit,
    wasm.i32$and,
    wasm.if, wasm.i32,
      wasm.local$get, ...arr,
      wasm.local$get, ...val_idx,
      wasm.call, ...refs_array_get.func_idx_leb128,
      wasm.local$set, ...val_or_node,
      wasm.local$get, ...arr,
      wasm.local$get, ...key_idx,
      wasm.call, ...refs_array_get.func_idx_leb128,
      wasm.local$tee, ...key_or_nil,
      wasm.if, wasm.i32,
        wasm.local$get, ...key,
        wasm.local$get, ...key_or_nil,
        wasm.call, ...eq.func_idx_leb128,
        wasm.if, wasm.i32,
          wasm.local$get, ...val,
          wasm.local$get, ...val_or_node,
          wasm.i32$eq,
          wasm.if, wasm.i32,
            wasm.local$get, ...inode,
            // will be referenced anew
            wasm.call, ...inc_refs.func_idx_leb128,
          wasm.else,
            wasm.local$get, ...bitmap,
            wasm.local$get, ...arr,
            wasm.local$get, ...val_idx,
            wasm.call, ...refs_array_fit_and_copy.func_idx_leb128,
            wasm.local$get, ...val_idx,
            wasm.local$get, ...val,
            wasm.call, ...refs_array_set.func_idx_leb128,
            wasm.call, ...types.BitmapIndexedNode.constr.leb128,
          wasm.end,
        wasm.else,
          wasm.local$get, ...added_leaf,
          wasm.i32$const, 1,
          wasm.i32$store, 2, 0,
          wasm.local$get, ...bitmap,
          wasm.local$get, ...arr,
          wasm.local$get, ...val_idx,
          wasm.call, ...refs_array_fit_and_copy.func_idx_leb128,
          wasm.local$get, ...key_idx,
          wasm.i32$const, 0,
          wasm.call, ...refs_array_set.func_idx_leb128,
          wasm.local$get, ...val_idx,
          wasm.local$get, ...new_shift,
          wasm.local$get, ...key_or_nil,
          wasm.local$get, ...val_or_node,
          wasm.local$get, ...hsh,
          wasm.local$get, ...key,
          wasm.local$get, ...val,
          wasm.call, ...create_node.func_idx_leb128,
          // node is new and internal, so no inc_refs
          wasm.call, ...refs_array_set_no_inc.func_idx_leb128,
          wasm.call, ...types.BitmapIndexedNode.constr.leb128,
        wasm.end,
      wasm.else,
        wasm.local$get, ...val_or_node,
        wasm.local$get, ...new_shift,
        wasm.local$get, ...hsh,
        wasm.local$get, ...key,
        wasm.local$get, ...val,
        wasm.local$get, ...added_leaf,
        wasm.call, ...inode_assoc.func_idx_leb128,
        wasm.local$tee, ...new_node,
        wasm.local$get, ...val_or_node,
        wasm.i32$eq,
        wasm.if, wasm.i32,
          wasm.local$get, ...new_node,
          wasm.call, ...free.func_idx_leb128,
          wasm.local$get, ...inode,
          // will be referenced anew
          wasm.call, ...inc_refs.func_idx_leb128,
        wasm.else,
          wasm.local$get, ...bitmap,
          wasm.local$get, ...arr,
          wasm.local$get, ...val_idx,
          wasm.call, ...refs_array_fit_and_copy.func_idx_leb128,
          wasm.local$get, ...val_idx,
          wasm.local$get, ...new_node,
          // new_node is new and internal so no inc_refs
          wasm.call, ...refs_array_set_no_inc.func_idx_leb128,
          wasm.call, ...types.BitmapIndexedNode.constr.leb128,
        wasm.end,
      wasm.end,
    wasm.else,
      wasm.local$get, ...bitmap,
      wasm.i32$popcnt,
      wasm.local$tee, ...n,
      wasm.i32$const, 16,
      wasm.i32$ge_u,
      wasm.if, wasm.i32,
        wasm.local$get, ...n,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.i32$const, 32,
        wasm.call, ...refs_array_by_length.func_idx_leb128,
        wasm.local$tee, ...new_arr,
        wasm.local$get, ...hsh,
        wasm.local$get, ...shift,
        wasm.call, ...mask.func_idx_leb128,
        wasm.local$tee, ...jdx,
        wasm.i32$const, ...leb128(empty_bitmap_indexed_node),
        wasm.local$get, ...new_shift,
        wasm.local$get, ...hsh,
        wasm.local$get, ...key,
        wasm.local$get, ...val,
        wasm.local$get, ...added_leaf,
        wasm.call, ...inode_assoc.func_idx_leb128,
        wasm.call, ...refs_array_set_no_inc.func_idx_leb128,
        wasm.loop, wasm.void,
          wasm.local$get, ...i,
          wasm.i32$const, 32,
          wasm.i32$lt_u,
          wasm.if, wasm.void,
            wasm.local$get, ...bitmap,
            wasm.local$get, ...i,
            wasm.i32$shr_u,
            wasm.i32$const, 1,
            wasm.i32$and,
            wasm.if, wasm.void,
              wasm.local$get, ...arr,
              wasm.local$get, ...j,
              wasm.call, ...refs_array_get.func_idx_leb128,
              wasm.local$set, ...key,
              wasm.local$get, ...arr,
              wasm.local$get, ...j,
              wasm.i32$const, 1,
              wasm.i32$add,
              wasm.call, ...refs_array_get.func_idx_leb128,
              wasm.local$set, ...val,
              wasm.local$get, ...new_arr,
              wasm.local$get, ...i,
              wasm.local$get, ...key,
              wasm.if, wasm.i32,
                wasm.i32$const, ...leb128(empty_bitmap_indexed_node),
                wasm.local$get, ...new_shift,
                wasm.local$get, ...key,
                wasm.call, ...hash.func_idx_leb128,
                wasm.local$get, ...key,
                wasm.local$get, ...val,
                wasm.local$get, ...added_leaf,
                wasm.call, ...inode_assoc.func_idx_leb128,
              wasm.else,
                wasm.local$get, ...val,
                wasm.call, ...inc_refs.func_idx_leb128,
              wasm.end,
              wasm.call, ...refs_array_set_no_inc.func_idx_leb128,
              wasm.drop,
              wasm.local$get, ...j,
              wasm.i32$const, 2,
              wasm.i32$add,
              wasm.local$set, ...j,
            wasm.end,
            wasm.local$get, ...i,
            wasm.i32$const, 1,
            wasm.i32$add,
            wasm.local$set, ...i,
            wasm.br, 1,
          wasm.end,
        wasm.end,
        wasm.call, ...types.ArrayNode.constr.leb128,
      wasm.else,
        wasm.local$get, ...added_leaf,
        wasm.i32$const, 1,
        wasm.i32$store, 2, 0,
        wasm.local$get, ...bitmap,
        wasm.local$get, ...bit,
        wasm.i32$or,
        wasm.local$get, ...arr,
        wasm.local$get, ...key_idx,
        wasm.local$get, ...arr,
        wasm.i32$const, 0,
        wasm.local$get, ...n,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.i32$const, 2,
        wasm.i32$mul,
        wasm.call, ...refs_array_by_length.func_idx_leb128,
        wasm.local$tee, ...new_arr,
        wasm.i32$const, 0,
        wasm.local$get, ...key_idx,
        wasm.call, ...refs_array_copy.func_idx_leb128,
        wasm.local$get, ...key_idx,
        wasm.local$get, ...key,
        wasm.call, ...refs_array_set.func_idx_leb128,
        wasm.local$get, ...val_idx,
        wasm.local$get, ...val,
        wasm.call, ...refs_array_set.func_idx_leb128,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.i32$const, 2,
        wasm.i32$mul,
        wasm.local$get, ...n,
        wasm.local$get, ...idx,
        wasm.i32$sub,
        wasm.i32$const, 2,
        wasm.i32$mul,
        wasm.call, ...refs_array_copy.func_idx_leb128,
        wasm.call, ...types.BitmapIndexedNode.constr.leb128,
      wasm.end,
    wasm.end
  );
});

inode_lookup.implement(types.BitmapIndexedNode, function (func) {
  const inode = func.param(wasm.i32),
        shift = func.param(wasm.i32),
        hsh = func.param(wasm.i32),
        key = func.param(wasm.i32),
        not_found = func.param(wasm.i32),
        bitmap = func.local(wasm.i32),
        arr = func.local(wasm.i32),
        bit = func.local(wasm.i32),
        key_idx = func.local(wasm.i32),
        key_or_nil = func.local(wasm.i32),
        val_or_node = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...inode,
    wasm.call, ...types.BitmapIndexedNode.fields.arr.leb128,
    wasm.local$set, ...arr,
    wasm.local$get, ...inode,
    wasm.call, ...types.BitmapIndexedNode.fields.bitmap.leb128,
    wasm.local$tee, ...bitmap,
    wasm.local$get, ...hsh,
    wasm.local$get, ...shift,
    wasm.call, ...bitpos.func_idx_leb128,
    wasm.local$tee, ...bit,
    wasm.i32$and,
    wasm.if, wasm.i32,
      wasm.local$get, ...arr,
      wasm.local$get, ...bitmap,
      wasm.local$get, ...bit,
      wasm.call, ...bitmap_indexed_node_index.func_idx_leb128,
      wasm.i32$const, 2,
      wasm.i32$mul,
      wasm.local$tee, ...key_idx,
      wasm.i32$const, 1,
      wasm.i32$add,
      wasm.call, ...refs_array_get.func_idx_leb128,
      wasm.local$set, ...val_or_node,
      wasm.local$get, ...arr,
      wasm.local$get, ...key_idx,
      wasm.call, ...refs_array_get.func_idx_leb128,
      wasm.local$tee, ...key_or_nil,
      wasm.if, wasm.i32,
        wasm.local$get, ...key,
        wasm.local$get, ...key_or_nil,
        wasm.call, ...eq.func_idx_leb128,
        wasm.if, wasm.i32,
          wasm.local$get, ...val_or_node,
        wasm.else,
          wasm.local$get, ...not_found,
        wasm.end,
      wasm.else,
        wasm.local$get, ...val_or_node,
        wasm.local$get, ...shift,
        wasm.i32$const, 5,
        wasm.i32$add,
        wasm.local$get, ...hsh,
        wasm.local$get, ...key,
        wasm.local$get, ...not_found,
        wasm.call, ...inode_lookup.func_idx_leb128,
      wasm.end,
    wasm.else,
      wasm.local$get, ...not_found,
    wasm.end
  );
});

inode_assoc.implement(types.ArrayNode, function (func) {
  const inode = func.param(wasm.i32),
        shift = func.param(wasm.i32),
        hsh = func.param(wasm.i32),
        key = func.param(wasm.i32),
        val = func.param(wasm.i32),
        added_leaf = func.param(wasm.i32),
        arr = func.local(wasm.i32),
        cnt = func.local(wasm.i32),
        idx = func.local(wasm.i32),
        node = func.local(wasm.i32),
        new_shift = func.local(wasm.i32),
        new_arr = func.local(wasm.i32),
        n = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...inode,
    wasm.call, ...types.ArrayNode.fields.count.leb128,
    wasm.local$set, ...cnt,
    wasm.local$get, ...shift,
    wasm.i32$const, 5,
    wasm.i32$add,
    wasm.local$set, ...new_shift,
    wasm.local$get, ...inode,
    wasm.call, ...types.ArrayNode.fields.arr.leb128,
    wasm.local$tee, ...arr,
    wasm.call, ...refs_array_clone.func_idx_leb128,
    wasm.local$tee, ...new_arr,
    wasm.local$get, ...hsh,
    wasm.local$get, ...shift,
    wasm.call, ...mask.func_idx_leb128,
    wasm.local$tee, ...idx,
    wasm.call, ...refs_array_get.func_idx_leb128,
    wasm.local$tee, ...node,
    wasm.if, wasm.i32,
      wasm.local$get, ...node,
      wasm.local$get, ...new_shift,
      wasm.local$get, ...hsh,
      wasm.local$get, ...key,
      wasm.local$get, ...val,
      wasm.local$get, ...added_leaf,
      wasm.call, ...inode_assoc.func_idx_leb128,
      wasm.local$tee, ...n,
      wasm.local$get, ...node,
      wasm.i32$eq,
      wasm.if, wasm.i32,
        wasm.local$get, ...new_arr,
        wasm.call, ...free.func_idx_leb128,
        wasm.local$get, ...inode,
        wasm.call, ...inc_refs.func_idx_leb128,
      wasm.else,
        wasm.local$get, ...cnt,
        wasm.local$get, ...new_arr,
        wasm.local$get, ...idx,
        wasm.local$get, ...n,
        // inode_assoc does inc_refs if necessary
        wasm.call, ...refs_array_set_no_inc.func_idx_leb128,
        wasm.call, ...types.ArrayNode.constr.leb128,
      wasm.end,
    wasm.else,
      wasm.local$get, ...cnt,
      wasm.i32$const, 1,
      wasm.i32$add,
      wasm.local$get, ...new_arr,
      wasm.local$get, ...idx,
      wasm.i32$const, ...leb128(empty_bitmap_indexed_node),
      wasm.local$get, ...new_shift,
      wasm.local$get, ...hsh,
      wasm.local$get, ...key,
      wasm.local$get, ...val,
      wasm.local$get, ...added_leaf,
      wasm.call, ...inode_assoc.func_idx_leb128,
      wasm.call, ...refs_array_set_no_inc.func_idx_leb128,
      wasm.call, ...types.ArrayNode.constr.leb128,
    wasm.end
  );
});

inode_lookup.implement(types.ArrayNode, function (func) {
  const inode = func.param(wasm.i32),
        shift = func.param(wasm.i32),
        hsh = func.param(wasm.i32),
        key = func.param(wasm.i32),
        not_found = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...inode,
    wasm.call, ...types.ArrayNode.fields.arr.leb128,
    wasm.local$get, ...hsh,
    wasm.local$get, ...shift,
    wasm.call, ...mask.func_idx_leb128,
    wasm.call, ...refs_array_get.func_idx_leb128,
    wasm.local$tee, inode,
    wasm.if, wasm.i32,
      wasm.local$get, ...inode,
      wasm.local$get, ...shift,
      wasm.i32$const, 5,
      wasm.i32$add,
      wasm.local$get, ...hsh,
      wasm.local$get, ...key,
      wasm.local$get, ...not_found,
      wasm.call, ...inode_lookup.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...not_found,
    wasm.end
  );
});
      
const hash_collision_node_find_index = func_builder(function (func) {
  const arr = func.param(wasm.i32),
        cnt = func.param(wasm.i32),
        key = func.param(wasm.i32),
        lim = func.local(wasm.i32),
        i = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...cnt,
    wasm.i32$const, 2,
    wasm.i32$mul,
    wasm.local$set, ...lim,
    wasm.loop, wasm.i32,
      wasm.local$get, ...i,
      wasm.local$get, ...lim,
      wasm.i32$lt_u,
      wasm.if, wasm.i32,
        wasm.local$get, ...arr,
        wasm.local$get, ...i,
        wasm.call, ...refs_array_get.func_idx_leb128,
        wasm.local$get, ...key,
        wasm.call, ...eq.func_idx_leb128,
        wasm.if, wasm.i32,
          wasm.local$get, ...i,
        wasm.else,
          wasm.local$get, ...i,
          wasm.i32$const, 2,
          wasm.i32$add,
          wasm.local$set, ...i,
          wasm.br, 2,
        wasm.end,
      wasm.else,
        wasm.i32$const, ...leb128(-1),
      wasm.end,
    wasm.end
  );
});

inode_lookup.implement(types.HashCollisionNode, function (func) {
  const inode = func.param(wasm.i32),
        shift = func.param(wasm.i32),
        hsh = func.param(wasm.i32),
        key = func.param(wasm.i32),
        not_found = func.param(wasm.i32),
        idx = func.local(wasm.i32),
        arr = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...inode,
    wasm.call, ...types.HashCollisionNode.fields.arr.leb128,
    wasm.local$tee, ...arr,
    wasm.local$get, ...inode,
    wasm.call, ...types.HashCollisionNode.fields.count.leb128,
    wasm.local$get, ...key,
    wasm.call, ...hash_collision_node_find_index.func_idx_leb128,
    wasm.local$tee, ...idx,
    wasm.i32$const, ...leb128(-1),
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.local$get, ...not_found,
    wasm.else,
      wasm.local$get, ...key,
      wasm.local$get, ...arr,
      wasm.local$get, ...idx,
      wasm.call, ...refs_array_get.func_idx_leb128,
      wasm.call, ...eq.func_idx_leb128,
      wasm.if, wasm.i32,
        wasm.local$get, ...arr,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.call, ...refs_array_get.func_idx_leb128,
      wasm.else,
        wasm.local$get, ...not_found,
      wasm.end,
    wasm.end
  );
});

inode_assoc.implement(types.HashCollisionNode, function (func) {
  const inode = func.param(wasm.i32),
        shift = func.param(wasm.i32),
        hsh = func.param(wasm.i32),
        key = func.param(wasm.i32),
        val = func.param(wasm.i32),
        added_leaf = func.param(wasm.i32),
        chash = func.local(wasm.i32),
        arr = func.local(wasm.i32),
        cnt = func.local(wasm.i32),
        idx = func.local(wasm.i32),
        val_idx = func.local(wasm.i32),
        tmp = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...inode,
    wasm.call, ...types.HashCollisionNode.fields.arr.leb128,
    wasm.local$set, ...arr,
    wasm.local$get, ...inode,
    wasm.call, ...types.HashCollisionNode.fields.count.leb128,
    wasm.local$set, ...cnt,
    wasm.local$get, ...inode,
    wasm.call, ...types.HashCollisionNode.fields.collision_hash.leb128,
    wasm.local$tee, ...chash,
    wasm.local$get, ...hsh,
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.local$get, ...arr,
      wasm.local$get, ...cnt,
      wasm.local$get, ...key,
      wasm.call, ...hash_collision_node_find_index.func_idx_leb128,
      wasm.local$tee, ...idx,
      wasm.i32$const, ...leb128(-1),
      wasm.i32$eq,
      wasm.if, wasm.i32,
        wasm.local$get, ...added_leaf,
        wasm.i32$const, 1,
        wasm.i32$store, 2, 0,
        wasm.local$get, ...hsh,
        wasm.local$get, ...cnt,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$get, ...arr,
        wasm.local$get, ...arr,
        wasm.call, ...types.RefsArray.fields.arr.leb128,
        wasm.call, ...types.Array.fields.length.leb128,
        wasm.local$tee, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$tee, ...val_idx,
        wasm.call, ...refs_array_fit_and_copy.func_idx_leb128,
        wasm.local$get, ...idx,
        wasm.local$get, ...key,
        wasm.call, ...refs_array_set.func_idx_leb128,
        wasm.local$get, ...val_idx,
        wasm.local$get, ...val,
        wasm.call, ...refs_array_set.func_idx_leb128,
        wasm.call, ...types.HashCollisionNode.constr.leb128,
      wasm.else,
        wasm.local$get, ...arr,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.call, ...refs_array_get.func_idx_leb128,
        wasm.local$get, ...val,
        wasm.call, ...eq.func_idx_leb128,
        wasm.if, wasm.i32,
          wasm.local$get, ...inode,
          wasm.call, ...inc_refs.func_idx_leb128,
        wasm.else,
          wasm.local$get, ...hsh,
          wasm.local$get, ...cnt,
          wasm.local$get, ...arr,
          wasm.call, ...refs_array_clone.func_idx_leb128,
          wasm.local$get, ...idx,
          wasm.i32$const, 1,
          wasm.i32$add,
          wasm.local$get, ...val,
          wasm.call, ...refs_array_set.func_idx_leb128,
          wasm.call, ...types.HashCollisionNode.constr.leb128,
        wasm.end,
      wasm.end,
    wasm.else,
      wasm.local$get, ...chash,
      wasm.local$get, ...shift,
      wasm.call, ...bitpos.func_idx_leb128,
      wasm.i32$const, 2,
      wasm.call, ...refs_array_by_length.func_idx_leb128,
      wasm.i32$const, 1,
      wasm.local$get, inode,
      wasm.call, ...refs_array_set.func_idx_leb128,
      wasm.call, ...types.BitmapIndexedNode.constr.leb128,
      wasm.local$tee, ...tmp,
      wasm.local$get, ...shift,
      wasm.local$get, ...hsh,
      wasm.local$get, ...key,
      wasm.local$get, ...val,
      wasm.local$get, ...added_leaf,
      wasm.call, ...inode_assoc.func_idx_leb128,
      wasm.local$get, ...tmp,
      wasm.call, ...free.func_idx_leb128,
    wasm.end
  );
});

assoc.implement(types.HashMap, function (func) {
  const map = func.param(wasm.i32),
        key = func.param(wasm.i32),
        val = func.param(wasm.i32),
        count = func.local(wasm.i32),
        root = func.local(wasm.i32),
        has_nil = func.local(wasm.i32),
        nil_val = func.local(wasm.i32),
        added_leaf = func.local(wasm.i32),
        new_root = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...map,
    wasm.call, ...types.HashMap.fields.count.leb128,
    wasm.local$set, ...count,
    wasm.local$get, ...map,
    wasm.call, ...types.HashMap.fields.root.leb128,
    wasm.local$set, ...root,
    wasm.local$get, ...map,
    wasm.call, ...types.HashMap.fields.has_nil.leb128,
    wasm.local$set, ...has_nil,
    wasm.local$get, ...map,
    wasm.call, ...types.HashMap.fields.nil_val.leb128,
    wasm.local$set, ...nil_val,
    wasm.local$get, ...key,
    wasm.if, wasm.i32,
      wasm.local$get, ...root,
      wasm.i32$const, 0,
      wasm.local$get, ...key,
      wasm.call, ...hash.func_idx_leb128,
      wasm.local$get, ...key,
      wasm.local$get, ...val,
      wasm.i32$const, 4,
      wasm.call, ...alloc.func_idx_leb128,
      wasm.local$tee, ...added_leaf,
      wasm.call, ...inode_assoc.func_idx_leb128,
      wasm.local$set, ...new_root,
      wasm.local$get, ...count,
      wasm.local$get, ...added_leaf,
      wasm.i32$load, 2, 0,
      wasm.i32$add,
      wasm.local$get, ...new_root,
      wasm.local$get, ...has_nil,
      wasm.local$get, ...nil_val,
      wasm.call, ...inc_refs.func_idx_leb128,
      wasm.call, ...types.HashMap.constr.leb128,
      wasm.local$get, ...added_leaf,
      wasm.i32$const, 4,
      wasm.call, ...free_mem.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...count,
      wasm.local$get, ...has_nil,
      wasm.if, wasm.i32,
        wasm.i32$const, 0,
      wasm.else,
        wasm.i32$const, 1,
      wasm.end,
      wasm.i32$add,
      wasm.local$get, ...root,
      // has not changed, referenced twice now
      wasm.call, ...inc_refs.func_idx_leb128,
      wasm.i32$const, 1,
      wasm.local$get, ...val,
      wasm.call, ...inc_refs.func_idx_leb128,
      wasm.call, ...types.HashMap.constr.leb128,
    wasm.end
  );
});

get.implement(types.HashMap, function (func) {
  const map = func.param(wasm.i32),
        key = func.param(wasm.i32),
        not_found = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...key,
    wasm.if, wasm.i32,
      wasm.local$get, ...map,
      wasm.call, ...types.HashMap.fields.root.leb128,
      wasm.i32$const, 0,
      wasm.local$get, ...key,
      wasm.call, ...hash.func_idx_leb128,
      wasm.local$get, ...key,
      wasm.local$get, ...not_found,
      wasm.call, ...inode_lookup.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...map,
      wasm.call, ...types.HashMap.fields.has_nil.leb128,
      wasm.if, wasm.i32,
        wasm.local$get, ...map,
        wasm.call, ...types.HashMap.fields.nil_val.leb128,
      wasm.else,
        wasm.local$get, ...not_found,
      wasm.end,
    wasm.end
  );
});

/*------*\
|        |
| symbol |
|        |
\*------*/

const symkw = function (which) {
  const store = new_atom(empty_hash_map);
  let type = types.Symbol;
  if (which === "keyword") type = types.Keyword;
  return func_builder(function (func) {
    const namespace = func.param(wasm.i32),
          name = func.param(wasm.i32),
          syms = func.local(wasm.i32),
          with_ns = func.local(wasm.i32),
          out = func.local(wasm.i32);
    func.add_result(wasm.i32);
    func.set_export(which);
    func.append_code(
      wasm.i32$const, ...leb128(store),
      wasm.call, ...atom_swap_lock.func_idx_leb128,
      wasm.local$tee, ...syms,
      wasm.local$get, ...namespace,
      wasm.i32$const, 0,
      wasm.call, ...get.func_idx_leb128,
      wasm.local$tee, ...with_ns,
      wasm.if, wasm.i32,
        wasm.local$get, ...with_ns,
        wasm.local$get, ...name,
        wasm.i32$const, 0,
        wasm.call, ...get.func_idx_leb128,
        wasm.local$tee, ...out,
      wasm.else,
        wasm.i32$const, ...leb128(empty_hash_map),
        wasm.local$set, ...with_ns,
        wasm.i32$const, 0,
      wasm.end,
      wasm.if, wasm.void,
        wasm.i32$const, ...leb128(store),
        wasm.call, ...atom_swap_unlock.func_idx_leb128,
        wasm.drop,
      wasm.else,
        wasm.local$get, ...namespace,
        wasm.call, ...inc_refs.func_idx_leb128,
        wasm.local$get, ...name,
        wasm.call, ...inc_refs.func_idx_leb128,
        wasm.call, ...type.constr.leb128,
        wasm.local$set, ...out,
        wasm.i32$const, ...leb128(store),
        wasm.local$get, ...syms,
        wasm.local$get, ...namespace,
        wasm.local$get, ...with_ns,
        wasm.local$get, ...name,
        wasm.local$get, ...out,
        wasm.call, ...assoc.func_idx_leb128,
        wasm.call, ...assoc.func_idx_leb128,
        wasm.call, ...atom_swap_set.func_idx_leb128,
        wasm.drop,
        wasm.local$get, ...with_ns,
        wasm.call, ...free.func_idx_leb128,
        // swap_set removes ref to atom, this does final free
        wasm.local$get, ...syms,
        wasm.call, ...free.func_idx_leb128,
      wasm.end,
      wasm.local$get, ...out,
    );
  });
}

const new_keyword = symkw("keyword");
const new_symbol = symkw("symbol");

compile();

/*--------*\
|          |
| bindings |
|          |
\*--------*/

// todo: check from here down (including free)

const global_env = new_atom(empty_hash_map);

const store_binding = func_builder(function (func) {
  const sym = func.param(wasm.i32),
        val = func.param(wasm.i32),
        env = func.param(wasm.i32),
        map = func.local(wasm.i32);
  func.set_export("store_binding");
  func.append_code(
    wasm.local$get, ...env,
    wasm.local$get, ...env,
    wasm.call, ...atom_swap_lock.func_idx_leb128,
    wasm.local$tee, ...map,
    wasm.local$get, ...sym,
    wasm.local$get, ...val,
    wasm.call, ...assoc.func_idx_leb128,
    wasm.call, ...atom_swap_set.func_idx_leb128,
    wasm.drop,
    wasm.local$get, ...map,
    wasm.call, ...free.func_idx_leb128
  );
});

// function store_func_binding (out, ns, name, func, params) {
//   out.push(
//     wasm.i32$const, ...leb128i32(thread_port),
//     wasm.i32$const, ...leb128i32(store_ref(ns)),
//     wasm.call, ...types.String.constr.leb128,
//     wasm.i32$const, ...leb128i32(thread_port),
//     wasm.i32$const, ...leb128i32(store_ref(name)),
//     wasm.call, ...types.String.constr.leb128,
//     wasm.call, ...new_symbol.func_idx_leb128,
//     wasm.i32$const, ...func,
//     wasm.i32$const, ...func,
//     wasm.call, ...add_to_func_table.func_idx_leb128,
//     wasm.i32$const, ...leb128i32(params),
//     wasm.i32$const, 0,
//     wasm.i32$const, 0,
//     wasm.i32$const, ...leb128i32(wasm.i32),
//     wasm.call, ...get_type_idx.func_idx_leb128,
//     wasm.i32$const, ...leb128i32(params),
//     wasm.call, ...CompFunc.constr.leb128,
//     wasm.i32$const, ...leb128i32(global_env),
//     wasm.call, ...store_binding.func_idx_leb128
//   );
// }

const make_comp_func = func_builder(function (func) {
  const func_num = func.param(wasm.i32),
        i32_args = func.param(wasm.i32),
        i64_args = func.param(wasm.i32),
        f64_args = func.param(wasm.i32),
        result = func.param(wasm.i32);
  func.set_export("make_comp_func");
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...func_num,
    wasm.i32$const, 0,
    wasm.local$get, ...func_num,
    wasm.call, ...add_to_func_table.func_idx_leb128,
    wasm.local$get, ...i32_args,
    wasm.local$get, ...i64_args,
    wasm.local$get, ...f64_args,
    wasm.local$get, ...result,
    wasm.call, ...get_type_idx.func_idx_leb128,
    wasm.local$get, ...result,
    wasm.local$get, ...i32_args,
    wasm.local$get, ...i64_args,
    wasm.local$get, ...f64_args,
    wasm.call, ...types.Function.constr.leb128
  );
});

const store_comp_func = func_builder(function (func) {
  const name = func.param(wasm.i32),
        i32_args = func.param(wasm.i32),
        i64_args = func.param(wasm.i32),
        f64_args = func.param(wasm.i32),
        result = func.param(wasm.i32),
        func_num = func.param(wasm.i32);
  func.set_export("store_comp_func");
  func.append_code(
    wasm.local$get, ...name,
    wasm.local$get, ...func_num,
    wasm.local$get, ...i32_args,
    wasm.local$get, ...i64_args,
    wasm.local$get, ...f64_args,
    wasm.local$get, ...result,
    wasm.call, ...make_comp_func.func_idx_leb128,
    wasm.i32$const, ...leb128(global_env),
    wasm.call, ...store_binding.func_idx_leb128
  );
});

compile();

/*------------*\
|              |
| finish types |
|              |
\*------------*/

function make_type_predicate (tpnm, type) {
  const mtd = pre_new_method(`${tpnm}$instance`, 1, 0, 0, "i32", function (func) {
    func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(wasm.i32$const, 0);
  });
  mtd.implement(type, function (func) {
    func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(wasm.i32$const, 1);
  });
  type.predicate_leb128 = mtd.func_idx_leb128;
}

const comp_types = new_atom(empty_vector_seq);

for (const type_name in types) {
  const type_info = types[type_name];
  let ts = comp.swap_lock(comp_types);
  const type = comp.Type(type_info.type_num);
  ts = comp.conj(ts, type);
  comp.swap_set(comp_types, ts);
  comp.store_binding(make_symbol(type_name), type, global_env);
  comp.store_comp_func(
    make_symbol(type_name, "new"),
    type_info.constr.params.filter(({wasm_type})=>wasm_type===wasm.i32).length,
    type_info.constr.params.filter(({wasm_type})=>wasm_type===wasm.i64).length,
    type_info.constr.params.filter(({wasm_type})=>wasm_type===wasm.f64).length,
    wasm.i32,
    type_info.constr.func_num
  );
  for (const getter_name in type_info.fields) {
    const getter = type_info.fields[getter_name];
    if (getter.comp_type) {
      comp.store_comp_func(
        make_symbol(type_name, getter_name), 1, 0, 0, getter.comp_type,
        getter.comp_type === getter.wasm_type ? getter.func_num :
        func_builder(function (func) {
          const value = func.param(getter.wasm_type);
          func.add_result(wasm.i32);
          func.append_code(
            wasm.local$get, ...value,
            wasm.call, ...getter.leb128,
            wasm.i64$extend_i32_u,
            wasm.call, ...types.Int.constr.leb128
          );
        }).func_idx
      );
    }
  }
  make_type_predicate(type_name, type_info);
}

/*-------*\
|         |
| methods |
|         |
\*-------*/

const methods = new_atom(empty_vector_seq);

const impl_def_func_all_methods = func_builder(function (func) {
  const tpnm = func.param(wasm.i32),
        mtds = func.local(wasm.i32),
        mtd = func.local(wasm.i32);
  func.append_code(
    wasm.i32$const, ...leb128(methods),
    wasm.call, ...atom_deref.func_idx_leb128,
    wasm.local$set, ...mtds,
    wasm.loop, wasm.void,
      wasm.local$get, ...mtds,
      wasm.i32$const, ...leb128(empty_vector_seq),
      wasm.i32$ne,
      wasm.if, wasm.void,
        wasm.local$get, ...mtds,
        wasm.call, ...first.func_idx_leb128,
        wasm.local$tee, ...mtd,
        wasm.call, ...types.Method.fields.num.leb128,
        wasm.local$get, ...tpnm,
        wasm.local$get, ...mtd,
        wasm.call, ...types.Method.fields.default_func.leb128,
        wasm.call, ...impl_method.func_idx_leb128,
        wasm.local$get, ...mtds,
        wasm.call, ...rest.func_idx_leb128,
        wasm.local$set, ...mtds,
        wasm.br, 1,
      wasm.end,
    wasm.end
  );
});

const impl_def_func_all_types = func_builder(function (func) {
  const mtd = func.param(wasm.i32),
        tps = func.local(wasm.i32),
        mtd_num = func.local(wasm.i32),
        def_fnc = func.local(wasm.i32);
  func.set_export("impl_def_func_all_types");
  func.append_code(
    wasm.i32$const, ...leb128(comp_types),
    wasm.call, ...atom_deref.func_idx_leb128,
    wasm.local$set, ...tps,
    wasm.local$get, ...mtd,
    wasm.call, ...types.Method.fields.num.leb128,
    wasm.local$set, ...mtd_num,
    wasm.local$get, ...mtd,
    wasm.call, ...types.Method.fields.default_func.leb128,
    wasm.local$set, ...def_fnc,
    wasm.loop, wasm.void,
      wasm.local$get, ...tps,
      wasm.i32$const, ...leb128(empty_vector_seq),
      wasm.i32$ne,
      wasm.if, wasm.void,
        wasm.local$get, ...mtd_num,
        wasm.local$get, ...tps,
        wasm.call, ...first.func_idx_leb128,
        wasm.call, ...types.Type.fields.num.leb128,
        wasm.local$get, ...def_fnc,
        wasm.call, ...impl_method.func_idx_leb128,
        wasm.local$get, ...tps,
        wasm.call, ...rest.func_idx_leb128,
        wasm.local$set, ...tps,
        wasm.br, 1,
      wasm.end,
    wasm.end
  );
});

const store_method = func_builder(function (func) {
  const mtd_num = func.param(wasm.i32),
        def_fnc = func.param(wasm.i32),
        main_fnc = func.param(wasm.i32),
        mtd = func.local(wasm.i32),
        mtds = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.set_export("store_method");
  func.append_code(
    wasm.i32$const, ...leb128(methods),
    wasm.i32$const, ...leb128(methods),
    wasm.call, ...atom_swap_lock.func_idx_leb128,
    wasm.local$tee, ...mtds,
    wasm.local$get, ...mtd_num,
    wasm.local$get, ...def_fnc,
    wasm.local$get, ...main_fnc,
    wasm.call, ...types.Method.constr.leb128,
    wasm.local$tee, ...mtd,
    wasm.call, ...conj.func_idx_leb128,
    wasm.call, ...atom_swap_set.func_idx_leb128,
    wasm.drop,
    wasm.local$get, ...mtds,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...mtd
  );
});

compile();

for (const m of defined_methods) {
  comp.store_method(m.mtd_num, m.def_func, m.func_idx);
}

function new_method (name, num_args, result, def_func) {
// todo: should all methods be exported? if not, don't pass name
  const out = def_mtd(name, num_args, 0, 0, result, def_func);
  comp.impl_def_func_all_types(
    comp.store_method(out.mtd_num, out.def_func, out.func_idx)
  );
  return out;
}

comp.store_comp_func(
  make_symbol("print-js"), 1, 0, 0, wasm.i32,
  func_builder(function (func) {
    const val = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...val,
      wasm.call, ...to_js.func_idx_leb128,
      wasm.call, ...print_obj.func_idx_leb128,
      wasm.i32$const, nil
    );
  }).func_idx
);

comp.store_comp_func(
  make_symbol("print-i32"), 1, 0, 0, wasm.i32,
  func_builder(function (func) {
    const num = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...num,
      wasm.call, ...print_i32.func_idx_leb128,
      wasm.i32$const, nil
    );
  }).func_idx
);

comp.store_comp_func(
  make_symbol("i64-to-string"), 0, 1, 0, wasm.i32,
  i64_to_string.func_idx
);

comp.store_comp_func(
  make_symbol("print-refs"), 1, 0, 0, wasm.i32,
  func_builder(function (func) {
    const num = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...num,
      wasm.i32$const, 4,
      wasm.i32$add,
      wasm.i32$load, 2, 0,
      wasm.call, ...print_i32.func_idx_leb128,
      wasm.i32$const, nil
    );
  }).func_idx
);

comp.store_comp_func(
  make_symbol("print-i64"), 0, 1, 0, wasm.i32,
  func_builder(function (func) {
    const num = func.param(wasm.i64);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...num,
      wasm.call, ...print_i64.func_idx_leb128,
      wasm.i32$const, nil
    );
  }).func_idx
);

comp.store_comp_func(
  make_symbol("symbol"), 2, 0, 0, wasm.i32,
  func_builder(function (func) {
    const ns = func.param(wasm.i32),
          nm = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...ns,
      wasm.local$get, ...nm,
      wasm.call, ...new_symbol.func_idx_leb128
    );
  }).func_idx
);

comp.store_comp_func(
  make_symbol("vector->seq"), 1, 0, 0, wasm.i32,
  func_builder(function (func) {
    const vec = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...vec,
      wasm.call, ...types.Vector.fields.count.leb128,
      wasm.local$get, ...vec,
      wasm.i32$const, 0,
      wasm.call, ...types.VectorSeq.constr.leb128
    );
  }).func_idx
);

comp.store_comp_func(
  make_symbol("vec-count"), 1, 0, 0, wasm.i32,
  func_builder(function (func) {
    const vec = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...vec,
      wasm.call, ...types.Vector.fields.count.leb128,
      wasm.i64$extend_i32_u,
      wasm.call, ...types.Int.constr.leb128
    );
  }).func_idx
);

comp.store_comp_func(make_symbol("nth"), 3, 0, 0, wasm.i32, nth.func_idx);

comp.store_comp_func(make_symbol("conj"), 2, 0, 0, wasm.i32, conj.func_idx);

comp.store_comp_func(make_symbol("concat-str"), 2, 0, 0, wasm.i32, concat_str.func_idx);

comp.store_comp_func(
  make_symbol("array-get-i8"), 2, 0, 0, wasm.i32,
  func_builder(function (func) {
    const arr = func.param(wasm.i32),
          idx = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...idx,
      wasm.call, ...types.Int.fields.value.leb128,
      wasm.i32$wrap_i64,
      wasm.local$tee, ...idx,
      wasm.local$get, ...arr,
      wasm.call, ...types.Array.fields.length.leb128,
      wasm.i32$lt_u,
      wasm.if, wasm.i32,
        wasm.local$get, ...arr,
        wasm.local$get, ...idx,
        wasm.call, ...array_get_i8.func_idx_leb128,
// todo: should be unsigned or signed?
        wasm.i64$extend_i32_s,
        wasm.call, ...types.Int.constr.leb128,
      wasm.else,
        wasm.i32$const, 0,
        wasm.i32$const, 0,
        wasm.throw, 0,
      wasm.end
    );
  }).func_idx
);

comp.store_comp_func(
  make_symbol("array-set-i8"), 3, 0, 0, wasm.i32,
  func_builder(function (func) {
    const arr = func.param(wasm.i32),
          idx = func.param(wasm.i32),
          num = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...idx,
      wasm.call, ...types.Int.fields.value.leb128,
      wasm.i32$wrap_i64,
      wasm.local$tee, ...idx,
      wasm.local$get, ...arr,
      wasm.call, ...types.Array.fields.length.leb128,
      wasm.i32$lt_u,
      wasm.if, wasm.i32,
        wasm.local$get, ...arr,
        wasm.local$get, ...idx,
        wasm.local$get, ...num,
        wasm.call, ...types.Int.fields.value.leb128,
        wasm.i32$wrap_i64,
        wasm.call, ...array_set_i8.func_idx_leb128,
      wasm.else,
        wasm.i32$const, 0,
        wasm.i32$const, 0,
        wasm.throw, 0,
      wasm.end
    );
  }).func_idx
);

/*----------*\
|            |
| free-local |
|            |
\*----------*/

const toggle_local_refs = new_method(null, 1, wasm.i32, function (func) {
  const val = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...val,
    wasm.i32$const, ...leb128(types.Symbol.fields.local_refs.offset),
    wasm.i32$add,
    wasm.i32$const, 0,
    wasm.atomic$prefix,
    wasm.i32$atomic$rmw$xchg, 2, 0,
    wasm.if, wasm.i32,
      wasm.local$get, ...val,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

const off_local_refs = new_method(null, 1, wasm.i32, function (func) {
  const val = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...val,
    wasm.i32$const, ...leb128(types.Symbol.fields.local_refs.offset),
    wasm.i32$add,
    wasm.i32$const, 0,
    wasm.atomic$prefix,
    wasm.i32$atomic$rmw$xchg, 2, 0,
    wasm.drop,
    wasm.local$get, ...val,
  );
});

const on_local_refs = new_method(null, 1, 0, function (func) {
  const val = func.param(wasm.i32);
  func.append_code(
    wasm.local$get, ...val,
    wasm.i32$const, ...leb128(types.Symbol.fields.local_refs.offset),
    wasm.i32$add,
    wasm.i32$const, 1,
    wasm.atomic$prefix,
    wasm.i32$atomic$rmw$xchg, 2, 0,
    wasm.drop
  );
});

for (const type of [types.Nil, types.False, types.True]) {
  toggle_local_refs.implement(type, function (func) {
    func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(wasm.i32$const, 0);
  });
  off_local_refs.implement(type, function (func) {
    const val = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(wasm.local$get, ...val);
  });
  on_local_refs.implement(type, function (func) {
    const val = func.param(wasm.i32);
  });
}

/*---------*\
|           |
| emit-code |
|           |
\*---------*/

const lookup_ref = func_builder(function (func) {
  const func_name = func.param(wasm.i32),
        out = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.i32$const, ...leb128(global_env),
    wasm.call, ...atom_deref.func_idx_leb128,
    wasm.local$get, ...func_name,
    // -1 is not a valid memory address since
    // any value will require more than one byte
    wasm.i32$const, ...leb128(-1),
    wasm.call, ...get.func_idx_leb128,
    wasm.local$tee, ...out,
    wasm.i32$const, ...leb128(-1),
    wasm.i32$eq,
    wasm.if, wasm.void,
// todo: more descriptive message
      wasm.i32$const, def_exception("invalid reference"),
      wasm.local$get, ...func_name,
      wasm.throw, 0,
    wasm.end,
    wasm.local$get, ...out
  );
});

const compile_form = func_builder();

const emit_code_default = func_builder(function (func) {
  const val = func.param(wasm.i32),
        _func = func.param(wasm.i32),
        env = func.param(wasm.i32);
  func.add_result(wasm.i32);
  // default is just to add the value as a literal
  func.append_code(
    wasm.local$get, ..._func,
    wasm.i32$const, ...leb128(wasm.i32$const),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...val,
    wasm.call, ...append_varsint32.func_idx_leb128
  );
});

const emit_code = new_method("emit_code", 3, wasm.i32, emit_code_default);

// todo: what if symbol is bound to i64 or f64?
emit_code.implement(types.Symbol, function (_func) {
  const sym = _func.param(wasm.i32),
        func = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        bdg_val = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...env,
    wasm.local$get, ...sym,
// todo: don't allow 2**32-1 as local index
    wasm.i32$const, ...leb128(-1),
    wasm.call, ...get.func_idx_leb128,
    wasm.local$tee, ...bdg_val,
    wasm.i32$const, ...leb128(-1),
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.local$get, ...func,
      wasm.i32$const, ...leb128(wasm.i32$const),
      wasm.call, ...append_code.func_idx_leb128,
      wasm.local$get, ...sym,
      wasm.call, ...lookup_ref.func_idx_leb128,
      wasm.call, ...append_varsint32.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...func,
      wasm.i32$const, ...leb128(wasm.local$get),
      wasm.call, ...append_code.func_idx_leb128,
      wasm.local$get, ...bdg_val,
      wasm.call, ...types.Boxedi32.fields.value.leb128,
      wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.end
  );
});

const get_sig_type = func_builder(function (func) {
  const p = func.param(wasm.i32),
        curr_type = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...p,
    wasm.call, ...types.Metadata.predicate_leb128,
    wasm.if, wasm.i32,
      wasm.local$get, ...p,
      wasm.call, ...types.Metadata.fields.meta.leb128,
      wasm.local$tee, ...curr_type,
      wasm.i32$const, ...leb128(make_symbol("i64")),
      wasm.i32$eq,
      wasm.if, wasm.i32,
        wasm.i32$const, ...leb128(wasm.i64),
      wasm.else,
        wasm.local$get, ...curr_type,
        wasm.i32$const, ...leb128(make_symbol("f64")),
        wasm.i32$eq,
        wasm.if, wasm.i32,
          wasm.i32$const, ...leb128(wasm.f64),
        wasm.else,
          wasm.i32$const, def_exception("invalid type notation"),
          wasm.local$get, ...curr_type,
          wasm.throw, 0,
        wasm.end,
      wasm.end,
      wasm.local$get, ...p,
      wasm.call, ...types.Metadata.fields.data.leb128,
      wasm.local$set, ...p,
    wasm.else,
      wasm.i32$const, ...leb128(wasm.i32),
    wasm.end,
    wasm.local$get, ...p
  );
});

const inc_locals = func_builder(function (func) {
  const env = func.param(wasm.i32),
        fn = func.param(wasm.i32),
        is_loc = func.param(wasm.i32),
        loc_typ = func.param(wasm.i32),
        loc_cnt = func.local(wasm.i32),
        locals = func.local(wasm.i32),
        arr = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...is_loc,
    wasm.if, wasm.void,
      wasm.local$get, ...fn,
      wasm.local$get, ...loc_typ,
      wasm.call, ...add_local.func_idx_leb128,
      wasm.drop,
    wasm.else,
      wasm.local$get, ...fn,
      wasm.local$get, ...loc_typ,
      wasm.call, ...add_param.func_idx_leb128,
      wasm.drop,
    wasm.end,
    wasm.local$get, ...env,
    wasm.i32$const, ...leb128(make_keyword("locals")),
    wasm.i32$const, nil,
    wasm.call, ...get.func_idx_leb128,
    wasm.local$tee, ...locals,
    wasm.i32$const, ...leb128(types.Boxedi32.fields.value.offset),
    wasm.i32$add,
    wasm.local$get, ...locals,
    wasm.call, ...types.Boxedi32.fields.value.leb128,
    wasm.local$tee, ...arr,
    wasm.local$get, ...loc_typ,
    wasm.call, ...array_push_i32.func_idx_leb128,
    wasm.i32$store, 2, 0,
    wasm.local$get, ...arr,
    wasm.call, ...types.Array.fields.length.leb128,
    wasm.local$get, ...arr,
    wasm.call, ...free.func_idx_leb128
  );
});

const add_local_to_free = func_builder(function (func) {
  const loc = func.param(wasm.i32),
        env = func.param(wasm.i32),
        typ = func.param(wasm.i32),
        box = func.local(wasm.i32),
        arr = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...typ,
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.i32$eq,
    wasm.if, wasm.void,
      wasm.local$get, ...env,
      wasm.i32$const, ...leb128(make_keyword("locals-to-free")),
      wasm.i32$const, nil,
      wasm.call, ...get.func_idx_leb128,
      wasm.local$tee, ...box,
      wasm.i32$const, ...leb128(types.Boxedi32.fields.value.offset),
      wasm.i32$add,
      wasm.local$get, ...box,
      wasm.call, ...types.Boxedi32.fields.value.leb128,
      wasm.local$tee, ...arr,
      wasm.local$get, ...loc,
      wasm.call, ...array_push_i32.func_idx_leb128,
      wasm.i32$store, 2, 0,
      wasm.local$get, ...arr,
      wasm.call, ...free.func_idx_leb128,
    wasm.end,
    wasm.local$get, ...loc
  );
});

const locals_array = func_builder(function (_func) {
  const env = _func.param(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...env,
    wasm.i32$const, ...leb128(make_keyword("locals")),
    wasm.i32$const, nil,
    wasm.call, ...get.func_idx_leb128,
    wasm.call, ...types.Boxedi32.fields.value.leb128
  );
});

const locals_to_free = func_builder(function (_func) {
  const env = _func.param(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...env,
    wasm.i32$const, ...leb128(make_keyword("locals-to-free")),
    wasm.i32$const, nil,
    wasm.call, ...get.func_idx_leb128,
    wasm.call, ...types.Boxedi32.fields.value.leb128
  );
});

const comp_func_set_params = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        params = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        curr_param = _func.local(wasm.i32),
        curr_type = _func.local(wasm.i32),
        param_count = _func.local(wasm.i32),
        param_index = _func.local(wasm.i32),
        result = _func.local(wasm.i32),
        i32_count = _func.local(wasm.i32),
        i64_count = _func.local(wasm.i32),
        f64_count = _func.local(wasm.i32);
  _func.add_result(wasm.i32, wasm.i32, wasm.i32, wasm.i32, wasm.i32);
  _func.append_code(
// todo: free this at end of function, then free all locals
    wasm.local$get, ...env,
    wasm.i32$const, ...leb128(make_keyword("locals")),
    wasm.i32$const, 0,
    wasm.call, ...array_by_length.func_idx_leb128,
    wasm.call, ...types.Boxedi32.constr.leb128,
    wasm.call, ...assoc.func_idx_leb128,
    wasm.local$tee, ...env,
    wasm.i32$const, ...leb128(make_keyword("locals-to-free")),
    wasm.i32$const, 0,
    wasm.call, ...array_by_length.func_idx_leb128,
    wasm.call, ...types.Boxedi32.constr.leb128,
    wasm.call, ...assoc.func_idx_leb128,
    wasm.local$get, ...env,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$set, ...env,
    wasm.local$get, ...func,
    wasm.local$get, ...params,
    wasm.call, ...get_sig_type.func_idx_leb128,
    wasm.local$set, ...params,
    wasm.local$tee, ...result,
    wasm.call, ...add_result.func_idx_leb128,
    wasm.drop,
    wasm.local$get, ...params,
    wasm.call, ...types.Vector.fields.count.leb128,
    wasm.local$tee, ...param_count,
    wasm.if, wasm.void,
      wasm.loop, wasm.void,
        wasm.local$get, ...param_index,
        wasm.local$get, ...param_count,
        wasm.i32$lt_u,
        wasm.if, wasm.void,
          wasm.local$get, ...params,
          wasm.local$get, ...param_index,
          wasm.i32$const, nil,
          wasm.call, ...nth.func_idx_leb128,
          wasm.call, ...get_sig_type.func_idx_leb128,
          wasm.local$set, ...curr_param,
          wasm.local$set, ...curr_type,
          wasm.local$get, ...env,
          wasm.local$get, ...env,
          wasm.local$get, ...curr_param,
          wasm.local$get, ...param_index,
          wasm.call, ...types.Boxedi32.constr.leb128,
          wasm.call, ...assoc.func_idx_leb128,
          wasm.local$tee, ...env,
          wasm.local$get, ...func,
          wasm.i32$const, 0,
          wasm.local$get, ...curr_type,
          wasm.call, ...inc_locals.func_idx_leb128,
          wasm.drop,
          wasm.call, ...free.func_idx_leb128,
          wasm.local$get, ...param_index,
          wasm.i32$const, 1,
          wasm.i32$add,
          wasm.local$set, ...param_index,
          wasm.local$get, ...curr_type,
          wasm.i32$const, ...leb128(wasm.i32),
          wasm.i32$eq,
          wasm.if, wasm.void,
            wasm.local$get, ...i32_count,
            wasm.i32$const, 1,
            wasm.i32$add,
            wasm.local$set, ...i32_count,
          wasm.else,
            wasm.local$get, ...curr_type,
            wasm.i32$const, ...leb128(wasm.i64),
            wasm.i32$eq,
            wasm.if, wasm.void,
              wasm.local$get, ...i64_count,
              wasm.i32$const, 1,
              wasm.i32$add,
              wasm.local$set, ...i64_count,
            wasm.else,
              wasm.local$get, ...curr_type,
              wasm.i32$const, ...leb128(wasm.f64),
              wasm.i32$eq,
              wasm.if, wasm.void,
                wasm.local$get, ...f64_count,
                wasm.i32$const, 1,
                wasm.i32$add,
                wasm.local$set, ...f64_count,
              wasm.end,
            wasm.end,
          wasm.end,
          wasm.br, 1,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.local$get, ...env,
    wasm.local$get, ...result,
    wasm.local$get, ...i32_count,
    wasm.local$get, ...i64_count,
    wasm.local$get, ...f64_count
  );
});

const get_local_num = func_builder(function (func) {
  const kw = leb128(comp.keyword(0, "local-count")),
        env = func.param(wasm.i32),
        map = func.local(wasm.i32),
        out = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...env,
    wasm.call, ...atom_swap_lock.func_idx_leb128,
    wasm.local$tee, ...map,
    wasm.i32$const, ...kw,
// todo: don't allow 2**32-1 as local index
    wasm.i32$const, ...leb128(-1),
    wasm.call, ...get.func_idx_leb128,
    wasm.local$tee, ...out,
    wasm.i32$const, ...leb128(-1),
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.i32$const, 0,
    wasm.else,
      wasm.local$get, ...out,
    wasm.end,
    wasm.local$tee, ...out,
    wasm.local$get, ...env,
    wasm.local$get, ...map,
    wasm.i32$const, ...kw,
    wasm.local$get, ...out,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.call, ...assoc.func_idx_leb128,
    wasm.call, ...atom_swap_set.func_idx_leb128,
    wasm.drop,
    wasm.local$get, ...map,
    wasm.call, ...free.func_idx_leb128
  );
});

const is_num64 = new_method(null, 2, wasm.i32, function (func) {
  const val = func.param(wasm.i32),
        env = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.i32$const, 0);
});

is_num64.implement(types.Symbol, function (func) {
  const sym = func.param(wasm.i32),
        env = func.param(wasm.i32),
        loc_num = func.local(wasm.i32),
        typ = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
// todo: add these changes to other place
    wasm.local$get, ...env,
    wasm.local$get, ...sym,
    wasm.i32$const, nil,
    wasm.call, ...get.func_idx_leb128,
    wasm.local$tee, ...loc_num,
    wasm.if, wasm.i32,
      wasm.local$get, ...env,
      wasm.call, ...locals_array.func_idx_leb128,
      wasm.local$get, ...loc_num,
      wasm.call, ...types.Boxedi32.fields.value.leb128,
      wasm.call, ...array_get_i32.func_idx_leb128,
      wasm.local$tee, ...typ,
      wasm.i32$const, ...leb128(wasm.i32),
      wasm.i32$eq,
      wasm.if, wasm.i32,
        wasm.i32$const, 0,
      wasm.else,
        wasm.local$get, ...typ,
      wasm.end,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

is_num64.implement(types.VectorSeq, function (func) {
  const list = func.param(wasm.i32),
        env = func.param(wasm.i32),
        sym = func.local(wasm.i32),
        ns = func.local(wasm.i32),
        func_record = func.local(wasm.i32),
        result = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...list,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$tee, ...sym,
    wasm.call, ...types.Symbol.predicate_leb128,
    wasm.if, wasm.i32,
      wasm.local$get, ...sym,
      wasm.call, ...types.Symbol.fields.namespace.leb128,
      wasm.local$tee, ...ns,
      wasm.if, wasm.i32,
        wasm.local$get, ...ns,
        wasm.i32$const, ...leb128(make_string("i64")),
        wasm.call, ...eq.func_idx_leb128,
        wasm.if, wasm.i32,
          wasm.i32$const, ...leb128(wasm.i64),
        wasm.else,
          wasm.local$get, ...ns,
          wasm.i32$const, ...leb128(make_symbol("f64")),
          wasm.i32$eq,
          wasm.if, wasm.i32,
            wasm.i32$const, ...leb128(wasm.f64),
          wasm.else,
            wasm.local$get, ...sym,
            wasm.call, ...lookup_ref.func_idx_leb128,
            wasm.local$tee, ...func_record,
            wasm.call, ...types.Function.predicate_leb128,
            wasm.if, wasm.i32,
              wasm.local$get, ...func_record,
              wasm.call, ...types.Function.fields.result.leb128,
              wasm.local$tee, ...result,
              wasm.i32$const, ...leb128(wasm.i64),
              wasm.i32$eq,
              wasm.local$get, ...result,
              wasm.i32$const, ...leb128(wasm.f64),
              wasm.i32$eq,
              wasm.i32$or,
            wasm.else,
              wasm.i32$const, 0,
            wasm.end,
          wasm.end,
        wasm.end,
      wasm.else,
        wasm.i32$const, 0,
      wasm.end,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

const comp_func_add_let = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        forms = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        bdgs = _func.local(wasm.i32),
        bdgs_cnt = _func.local(wasm.i32),
        bdg_idx = _func.local(wasm.i32),
        bdg_typ = _func.local(wasm.i32),
        val = _func.local(wasm.i32),
        local_idx = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...forms,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$tee, ...bdgs,
    wasm.call, ...types.Vector.fields.count.leb128,
    wasm.local$tee, ...bdgs_cnt,
    wasm.if, wasm.void,
      // env was passed from outside, so inc before freeing:
      wasm.local$get, ...env,
      wasm.call, ...inc_refs.func_idx_leb128,
      wasm.drop,
      wasm.loop, wasm.void,
        wasm.local$get, ...bdg_idx,
        wasm.local$get, ...bdgs_cnt,
        wasm.i32$lt_u,
        wasm.if, wasm.void,
          wasm.local$get, ...bdgs,
          wasm.local$get, ...bdg_idx,
          wasm.i32$const, 1,
          wasm.i32$add,
          wasm.i32$const, nil,
          wasm.call, ...nth.func_idx_leb128,
          wasm.local$tee, ...val,
          wasm.local$get, ...func,
          wasm.local$get, ...env,
          wasm.call, ...emit_code.func_idx_leb128,
          wasm.drop,
          wasm.local$get, ...val,
          wasm.call, ...is_seq.func_idx_leb128,
          wasm.local$get, ...val,
          wasm.local$get, ...env,
          wasm.call, ...is_num64.func_idx_leb128,
          wasm.local$tee, ...bdg_typ,
          wasm.if, wasm.i32,
            wasm.local$get, ...bdg_typ,
          wasm.else,
            wasm.i32$const, ...leb128(wasm.i32),
            wasm.local$tee, ...bdg_typ,
          wasm.end,
          wasm.i32$const, ...leb128(wasm.i32),
          wasm.i32$eq,
          wasm.i32$and,
          wasm.if, wasm.void,
            wasm.local$get, ...func,
            wasm.i32$const, ...leb128(wasm.drop),
            wasm.call, ...append_code.func_idx_leb128,
            wasm.drop,
            wasm.local$get, ...env,
            wasm.call, ...locals_array.func_idx_leb128,
            wasm.call, ...types.Array.fields.length.leb128,
            wasm.i32$const, 1,
            wasm.i32$sub,
            wasm.local$set, ...local_idx,
          wasm.else,
            wasm.local$get, ...func,
            wasm.i32$const, ...leb128(wasm.local$set),
            wasm.call, ...append_code.func_idx_leb128,
            wasm.local$get, ...env,
            wasm.local$get, ...func,
            wasm.i32$const, 1,
            wasm.local$get, ...bdg_typ,
            wasm.call, ...inc_locals.func_idx_leb128,
            wasm.local$tee, ...local_idx,
            wasm.call, ...append_varuint32.func_idx_leb128,
// todo: toggle local_refs
            wasm.drop,
          wasm.end,
          wasm.local$get, ...env,
          wasm.local$get, ...env,
          wasm.local$get, ...bdgs,
          wasm.local$get, ...bdg_idx,
          wasm.i32$const, nil,
          wasm.call, ...nth.func_idx_leb128,
          wasm.local$get, ...local_idx,
          wasm.call, ...types.Boxedi32.constr.leb128,
          wasm.call, ...assoc.func_idx_leb128,
          wasm.local$set, ...env,
          wasm.call, ...free.func_idx_leb128,
          wasm.local$get, ...bdg_idx,
          wasm.i32$const, 2,
          wasm.i32$add,
          wasm.local$set, ...bdg_idx,
          wasm.br, 1,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.loop, wasm.void,
      wasm.local$get, ...forms,
      wasm.call, ...rest.func_idx_leb128,
      wasm.local$tee, ...forms,
      wasm.call, ...types.VectorSeq.fields.count.leb128,
      wasm.if, wasm.void,
        wasm.local$get, ...forms,
        wasm.call, ...first.func_idx_leb128,
        wasm.local$get, ...func,
        wasm.local$get, ...env,
        wasm.call, ...emit_code.func_idx_leb128,
        wasm.drop,
      wasm.end,
    wasm.end,
    wasm.local$get, ...func
  );
});

const free_locals = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        locals = _func.local(wasm.i32),
        idx = _func.local(wasm.i32),
        local = _func.local(wasm.i32),
        cnt = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...env,
    wasm.call, ...locals_to_free.func_idx_leb128,
    wasm.local$tee, ...locals,
    wasm.call, ...types.Array.fields.length.leb128,
    wasm.local$set, ...cnt,
    wasm.loop, wasm.void,
      wasm.local$get, ...idx,
      wasm.local$get, ...cnt,
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        wasm.local$get, ...func,
        wasm.i32$const, ...leb128(wasm.local$get),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.local$get, ...locals,
        wasm.local$get, ...idx,
        wasm.call, ...array_get_i32.func_idx_leb128,
        wasm.local$tee, ...local,
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.i32$const, ...leb128(wasm.call),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.i32$const, ...toggle_local_refs.func_idx_leb128,
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.i32$const, ...leb128(wasm.if),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.i32$const, ...leb128(wasm.void),
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.i32$const, ...leb128(wasm.local$get),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.local$get, ...local,
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.i32$const, ...leb128(wasm.call),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.i32$const, ...leb128(free.func_idx),
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.i32$const, ...leb128(wasm.end),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.i32$const, ...leb128(wasm.local$get),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.local$get, ...local,
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.i32$const, ...leb128(wasm.call),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.i32$const, ...leb128(free.func_idx),
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.drop,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$set, ...idx,
        wasm.br, 0,
      wasm.end,
    wasm.end,
    wasm.local$get, ...func
  );
});

const comp_func = func_builder(function (_func) {
  const xpt = _func.param(wasm.i32),
        macro = _func.param(wasm.i32),
        form = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
	name = _func.local(wasm.i32),
        params = _func.local(wasm.i32),
        result = _func.local(wasm.i32),
        i32_count = _func.local(wasm.i32),
        i64_count = _func.local(wasm.i32),
        f64_count = _func.local(wasm.i32),
        body = _func.local(wasm.i32),
        func_num = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...form,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$set, ...name,
    wasm.local$get, ...form,
    wasm.call, ...rest.func_idx_leb128,
    wasm.local$tee, ...form,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$set, ...params,
    wasm.local$get, ...form,
    wasm.call, ...rest.func_idx_leb128,
    wasm.local$set, ...body,
    wasm.call, ...start_func.func_idx_leb128,
    wasm.local$tee, ...func_num,
    wasm.local$get, ...params,
    wasm.local$get, ...env,
    wasm.call, ...comp_func_set_params.func_idx_leb128,
    wasm.local$set, ...f64_count,
    wasm.local$set, ...i64_count,
    wasm.local$set, ...i32_count,
    wasm.local$set, ...result,
    wasm.local$set, ...env,
    wasm.local$get, ...xpt,
    wasm.if, wasm.void,
      wasm.local$get, ...func_num,
      wasm.local$get, ...name,
      wasm.call, ...types.Symbol.fields.name.leb128,
      wasm.call, ...store_string.func_idx_leb128,
      wasm.call, ...set_export.func_idx_leb128,
      wasm.drop,
    wasm.end,
    wasm.loop, wasm.void,
      wasm.local$get, ...body,
      wasm.i32$const, ...leb128(empty_vector_seq),
      wasm.i32$ne,
      wasm.if, wasm.void,
        wasm.local$get, ...body,
        wasm.call, ...first.func_idx_leb128,
        wasm.local$get, ...func_num,
        wasm.local$get, ...env,
        wasm.call, ...emit_code.func_idx_leb128,
        wasm.drop,
        wasm.local$get, ...body,
        wasm.call, ...rest.func_idx_leb128,
        wasm.local$tee, ...body,
        wasm.i32$const, ...leb128(empty_vector_seq),
        wasm.i32$eq,
        wasm.if, wasm.void,
          wasm.local$get, ...func_num,
          wasm.i32$const, ...leb128(wasm.call),
          wasm.call, ...append_code.func_idx_leb128,
          wasm.i32$const, ...leb128(off_local_refs.func_idx),
          wasm.call, ...append_varuint32.func_idx_leb128,
          wasm.drop,
        wasm.else,
          wasm.local$get, ...func_num,
          wasm.i32$const, ...leb128(wasm.drop),
          wasm.call, ...append_code.func_idx_leb128,
          wasm.drop,
          wasm.br, 2,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.local$get, ...func_num,
    wasm.local$get, ...env,
    wasm.call, ...free_locals.func_idx_leb128,
    wasm.call, ...end_func.func_idx_leb128,
    wasm.local$tee, ...func_num,
    wasm.local$get, ...macro,
    wasm.local$get, ...func_num,
    wasm.call, ...add_to_func_table.func_idx_leb128,
    wasm.local$get, ...i32_count,
    wasm.local$get, ...i64_count,
    wasm.local$get, ...f64_count,
    wasm.local$get, ...result,
    wasm.call, ...get_type_idx.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.local$get, ...i32_count,
    wasm.local$get, ...i64_count,
    wasm.local$get, ...f64_count,
    wasm.call, ...types.Function.constr.leb128,
  );
});

comp.store_comp_func(
  make_symbol("def"), 2, 0, 0, wasm.i32,
  func_builder(function (func) {
    const name = func.param(wasm.i32),
          val = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...name,
      wasm.local$get, ...val,
      wasm.i32$const, ...leb128(global_env),
      wasm.call, ...store_binding.func_idx_leb128,
      wasm.local$get, ...val
    );
  }).func_idx
);

const get_next_type_num = func_builder(function (func) {
  const ts = func.local(wasm.i32),
        type_num = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.i32$const, ...leb128(comp_types),
    wasm.i32$const, ...leb128(comp_types),
    wasm.call, ...atom_swap_lock.func_idx_leb128,
    wasm.local$tee, ...ts,
    wasm.local$get, ...ts,
    wasm.call, ...types.VectorSeq.fields.count.leb128,
    wasm.local$tee, ...type_num,
    wasm.call, ...types.Type.constr.leb128,
    wasm.call, ...conj.func_idx_leb128,
// todo: need to free previous ts?
    wasm.call, ...atom_swap_set.func_idx_leb128,
    wasm.drop,
    wasm.local$get, ...type_num,
  );
});

comp.store_comp_func(
  make_symbol("defmethod"), 2, 0, 0, wasm.i32,
  func_builder(function (func) {
    const mtd_name = func.param(wasm.i32),
          def_func = func.param(wasm.i32),
          mtd_func = func.local(wasm.i32),
          mtd_num = func.local(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
// todo: namespace
      wasm.i32$const, nil,
      wasm.local$get, ...mtd_name,
      wasm.call, ...new_symbol.func_idx_leb128,
      wasm.local$get, ...mtd_name,
      wasm.call, ...store_string.func_idx_leb128,
      wasm.local$get, ...def_func,
      wasm.call, ...types.Int.predicate_leb128,
      wasm.if, wasm.i32,
        wasm.local$get, ...def_func,
        wasm.call, ...types.Int.fields.value.leb128,
        wasm.i32$wrap_i64,
      wasm.else,
// todo: get args from default function
        wasm.i32$const, 0,
      wasm.end,
      wasm.i32$const, 0,
      wasm.i32$const, 0,
      wasm.i32$const, ...leb128(wasm.i32),
      wasm.call, ...new_comp_method.func_idx_leb128,
      wasm.local$set, ...mtd_num,
      wasm.local$set, ...mtd_func,
      wasm.local$get, ...mtd_num,
// todo: default_func
      wasm.i32$const, 0,
      wasm.local$get, ...mtd_func,
      wasm.call, ...store_method.func_idx_leb128,
      wasm.call, ...impl_def_func_all_types.func_idx_leb128,
      wasm.local$get, ...mtd_num,
      wasm.local$get, ...def_func,
      wasm.local$get, ...mtd_func,
      wasm.call, ...types.Method.constr.leb128,
      wasm.i32$const, ...leb128(global_env),
      wasm.call, ...store_binding.func_idx_leb128,
      wasm.i32$const, nil
    )
  }).func_idx
);

comp.store_comp_func(
  make_symbol("deftype"), 2, 0, 0, wasm.i32,
  func_builder(function (func) {
    const type_name = func.param(wasm.i32),
          fields = func.param(wasm.i32),
          inner_constr = func.local(wasm.i32),
          outer_constr = func.local(wasm.i32),
          type_num = func.local(wasm.i32),
          type_size = func.local(wasm.i32),
          field_num = func.local(wasm.i32),
          param_num = func.local(wasm.i32),
          field_name = func.local(wasm.i32),
          get_func = func.local(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.call, ...start_type.func_idx_leb128,
      wasm.local$set, ...outer_constr,
      wasm.local$set, ...inner_constr,

      wasm.call, ...get_next_type_num.func_idx_leb128,
      wasm.local$tee, ...type_num,
      wasm.call, ...impl_def_func_all_methods.func_idx_leb128,

      // type_num:
      wasm.local$get, ...inner_constr,
      wasm.local$get, ...outer_constr,
      wasm.local$get, ...type_size,
      wasm.local$get, ...field_num,
      wasm.local$get, ...param_num,
      wasm.i32$const, 0,
      wasm.i32$const, ...leb128(wasm.i32),
      wasm.i32$const, 1,
      wasm.local$get, ...type_num,
      wasm.call, ...add_type_field.func_idx_leb128,
      wasm.local$set, ...get_func,
      wasm.local$set, ...param_num,
      wasm.local$set, ...field_num,
      wasm.local$set, ...type_size,

      // refs:
      wasm.local$get, ...inner_constr,
      wasm.local$get, ...outer_constr,
      wasm.local$get, ...type_size,
      wasm.local$get, ...field_num,
      wasm.local$get, ...param_num,
      wasm.i32$const, 0,
      wasm.i32$const, ...leb128(wasm.i32),
      wasm.i32$const, 1,
      wasm.i32$const, 0,
      wasm.call, ...add_type_field.func_idx_leb128,
      wasm.local$set, ...get_func,
      wasm.local$set, ...param_num,
      wasm.local$set, ...field_num,
      wasm.local$set, ...type_size,

      // local_refs:
      wasm.local$get, ...inner_constr,
      wasm.local$get, ...outer_constr,
      wasm.local$get, ...type_size,
      wasm.local$get, ...field_num,
      wasm.local$get, ...param_num,
      wasm.i32$const, 0,
      wasm.i32$const, ...leb128(wasm.i32),
      wasm.i32$const, 1,
      wasm.i32$const, 1,
      wasm.call, ...add_type_field.func_idx_leb128,
      wasm.local$set, ...get_func,
      wasm.local$set, ...param_num,
      wasm.local$set, ...field_num,
      wasm.local$set, ...type_size,

      // hash:
      wasm.local$get, ...inner_constr,
      wasm.local$get, ...outer_constr,
      wasm.local$get, ...type_size,
      wasm.local$get, ...field_num,
      wasm.local$get, ...param_num,
      wasm.i32$const, 0,
      wasm.i32$const, ...leb128(wasm.i32),
      wasm.i32$const, 1,
      wasm.i32$const, 0,
      wasm.call, ...add_type_field.func_idx_leb128,
      wasm.local$set, ...get_func,
      wasm.local$set, ...param_num,
      wasm.local$set, ...field_num,
      wasm.local$set, ...type_size,

      wasm.loop, wasm.void,
        wasm.local$get, ...param_num,
        wasm.local$get, ...fields,
        wasm.call, ...types.Vector.fields.count.leb128,
        wasm.i32$lt_u,
        wasm.if, wasm.void,
          wasm.local$get, ...fields,
          wasm.local$get, ...param_num,
          wasm.i32$const, nil,
          wasm.call, ...nth.func_idx_leb128,
          wasm.local$set, ...field_name,

          wasm.local$get, ...inner_constr,
          wasm.local$get, ...outer_constr,
          wasm.local$get, ...type_size,
          wasm.local$get, ...field_num,
          wasm.local$get, ...param_num,
          wasm.i32$const, 0,
          wasm.i32$const, ...leb128(wasm.i32),
          wasm.i32$const, 0,
          wasm.i32$const, 0,
          wasm.call, ...add_type_field.func_idx_leb128,
          wasm.local$set, ...get_func,
          wasm.local$set, ...param_num,
          wasm.local$set, ...field_num,
          wasm.local$set, ...type_size,

          wasm.local$get, ...type_name,
          wasm.i32$const, ...leb128(make_string("get-")),
          wasm.local$get, ...field_name,
          wasm.call, ...concat_str.func_idx_leb128,
          wasm.call, ...new_symbol.func_idx_leb128,
          wasm.i32$const, 1,
          wasm.i32$const, 0,
          wasm.i32$const, 0,
          wasm.i32$const, ...leb128(wasm.i32),
          wasm.local$get, ...get_func,
          wasm.call, ...store_comp_func.func_idx_leb128,
          wasm.br, 1,
        wasm.end,
      wasm.end,
      wasm.local$get, ...inner_constr,
      wasm.local$get, ...outer_constr,
      wasm.local$get, ...type_size,
      wasm.local$get, ...param_num,
      wasm.local$get, ...type_name,
      wasm.call, ...store_string.func_idx_leb128,
      wasm.call, ...end_type.func_idx_leb128,
      wasm.local$set, ...type_size,
      wasm.local$set, ...param_num,
      wasm.local$set, ...outer_constr,
      wasm.local$get, ...type_name,
      wasm.i32$const, ...leb128(make_string("new")),
      wasm.call, ...new_symbol.func_idx_leb128,
      wasm.local$get, ...param_num,
      wasm.i32$const, 0,
      wasm.i32$const, 0,
      wasm.i32$const, ...leb128(wasm.i32),
      wasm.local$get, ...outer_constr,
      wasm.call, ...store_comp_func.func_idx_leb128,
  
      // wasm.i32$const, ...leb128(nil),
      // wasm.local$get, ...type_name,
      // wasm.call, ...new_symbol.func_idx_leb128,
      // wasm.local$get, ...type_num,
      // wasm.call, ...types.Type.constr_leb128,
      // wasm.i32$const, ...leb128(global_env),
      // wasm.call, ...store_binding.func_idx_leb128,
  
      // wasm.local$get, ...type_name,
      // wasm.i32$const, ...leb128(make_string("new")),
      // wasm.call, ...new_symbol.func_idx_leb128,
      // wasm.local$get, ...constructor_func,
      // wasm.local$get, ...constructor_func,
      // wasm.call, ...add_to_func_table.func_idx_leb128,
      // wasm.local$get, ...field_num,
      // wasm.i32$const, 0,
      // wasm.i32$const, 0,
      // wasm.i32$const, ...leb128(wasm.i32),
      // wasm.call, ...get_type_idx.func_idx_leb128,
      // wasm.local$get, ...field_num,
      // wasm.call, ...types.Function.constr_leb128,
      // wasm.i32$const, ...leb128(global_env),
      // wasm.call, ...store_binding.func_idx_leb128,
      // wasm.local$get, ...name
      wasm.i32$const, nil
    );
  }).func_idx
);

comp.store_comp_func(
  make_symbol("impl"), 3, 0, 0, wasm.i32,
  func_builder(function (func) {
    const mtd = func.param(wasm.i32),
          typ = func.param(wasm.i32),
          fnc = func.param(wasm.i32);
    func.add_result(wasm.i32);
    func.append_code(
      wasm.local$get, ...mtd,
      wasm.call, ...types.Method.fields.num.leb128,
      wasm.local$get, ...typ,
      wasm.call, ...types.Type.fields.num.leb128,
      wasm.local$get, ...fnc,
      wasm.call, ...types.Function.fields.func_num.leb128,
      wasm.call, ...impl_method.func_idx_leb128,
      wasm.i32$const, nil
    );
  }).func_idx
);

const inc_loop_depth = func_builder(function (func) {
  const env = func.param(wasm.i32),
        kw = leb128(make_keyword("loop-depth"));
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...env,
    wasm.i32$const, ...kw,
    wasm.local$get, ...env,
    wasm.i32$const, ...kw,
    wasm.i32$const, nil,
    wasm.call, ...get.func_idx_leb128,
    wasm.call, ...types.Boxedi32.fields.value.leb128,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.call, ...types.Boxedi32.constr.leb128,
    wasm.call, ...assoc.func_idx_leb128
  );
});

const comp_func_add_block = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        forms = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        op = _func.param(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...env,
    wasm.call, ...inc_loop_depth.func_idx_leb128,
    wasm.local$set, ...env,
    wasm.local$get, ...func,
    wasm.local$get, ...op,
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.loop, wasm.void,
      wasm.local$get, ...forms,
      wasm.call, ...first.func_idx_leb128,
      wasm.local$get, ...func,
      wasm.local$get, ...env,
      wasm.call, ...emit_code.func_idx_leb128,
      wasm.drop,
      wasm.local$get, ...forms,
      wasm.call, ...rest.func_idx_leb128,
      wasm.local$tee, ...forms,
      wasm.i32$const, ...leb128(empty_vector_seq),
      wasm.i32$ne,
      wasm.if, wasm.void,
        wasm.local$get, ...func,
        wasm.i32$const, ...leb128(wasm.drop),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.br, 1,
      wasm.end,
    wasm.end,
    wasm.i32$const, ...leb128(wasm.end),
    wasm.call, ...append_code.func_idx_leb128
  );
});

const comp_func_add_loop = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        forms = _func.param(wasm.i32),
        env = _func.param(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...func,
    wasm.local$get, ...forms,
    wasm.local$get, ...env,
    wasm.i32$const, ...leb128(make_keyword("loop-depth")),
    wasm.i32$const, ...leb128(-1),
    wasm.call, ...types.Boxedi32.constr.leb128,
    wasm.call, ...assoc.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.loop),
    wasm.call, ...comp_func_add_block.func_idx_leb128
  );
});

const comp_func_add_if = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        forms = _func.param(wasm.i32),
        env = _func.param(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...forms,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$get, ...func,
    wasm.local$get, ...env,
    wasm.call, ...inc_loop_depth.func_idx_leb128,
    wasm.local$tee, ...env,
    wasm.call, ...emit_code.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.if),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.drop,
    wasm.local$get, ...forms,
    wasm.call, ...rest.func_idx_leb128,
    wasm.local$tee, ...forms,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$get, ...func,
    wasm.local$get, ...env,
    wasm.call, ...emit_code.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.else),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.drop,
    wasm.local$get, ...forms,
    wasm.call, ...rest.func_idx_leb128,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$get, ...func,
    wasm.local$get, ...env,
    wasm.call, ...emit_code.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.end),
    wasm.call, ...append_code.func_idx_leb128
  );
});

const comp_func_add_throw = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        forms = _func.param(wasm.i32),
        env = _func.param(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...forms,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$get, ...func,
    wasm.local$get, ...env,
    wasm.call, ...emit_code.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.call),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, ...store_string.func_idx_leb128,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.drop,
    wasm.local$get, ...forms,
    wasm.call, ...rest.func_idx_leb128,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$get, ...func,
    wasm.local$get, ...env,
    wasm.call, ...emit_code.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.throw),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...append_code.func_idx_leb128
  );
});

const comp_func_add_set_local = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        forms = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        loc_num = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...env,
    wasm.call, ...locals_array.func_idx_leb128,
    wasm.local$get, ...env,
    wasm.local$get, ...forms,
    wasm.call, ...first.func_idx_leb128,
    wasm.i32$const, nil,
    wasm.call, ...get.func_idx_leb128,
    wasm.call, ...types.Boxedi32.fields.value.leb128,
    wasm.local$tee, ...loc_num,
    wasm.call, ...array_get_i32.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32),
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.i32$const, 0,
      wasm.i32$const, 0,
      wasm.throw, 0,
    wasm.else,
      wasm.local$get, ...forms,
      wasm.call, ...rest.func_idx_leb128,
      wasm.call, ...first.func_idx_leb128,
      wasm.local$get, ...func,
      wasm.local$get, ...env,
      wasm.call, ...emit_code.func_idx_leb128,
      wasm.i32$const, ...leb128(wasm.local$tee),
      wasm.call, ...append_code.func_idx_leb128,
      wasm.local$get, ...loc_num,
      wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.end
  );
});

const comp_func_add_recur = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        forms = _func.param(wasm.i32),
        env = _func.param(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...func,
    wasm.i32$const, ...leb128(wasm.br),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...env,
    wasm.i32$const, ...leb128(make_keyword("loop-depth")),
    wasm.i32$const, nil,
    wasm.call, ...get.func_idx_leb128,
    wasm.call, ...types.Boxedi32.fields.value.leb128,
    wasm.call, ...append_varuint32.func_idx_leb128
  );
});

const emit_float_literal = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        args = _func.param(wasm.i32),
        num = _func.local(wasm.i32),
        val = _func.local(wasm.i64),
        cnt = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...args,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$tee, ...num,
    wasm.call, ...types.Float.predicate_leb128,
    wasm.if, wasm.i32,
      wasm.local$get, ...func,
      wasm.i32$const, ...leb128(wasm.f64$const),
      wasm.call, ...append_code.func_idx_leb128,
      wasm.local$get, ...num,
      wasm.call, ...types.Float.fields.value.leb128,
      wasm.i64$reinterpret_f64,
      wasm.local$set, ...val,
      wasm.i32$const, 8,
      wasm.local$set, ...cnt,
      wasm.loop, wasm.void,
        wasm.local$get, ...func,
        wasm.i64$const, ...leb128(0b11111111),
        wasm.local$get, ...val,
        wasm.i64$and,
        wasm.i32$wrap_i64,
        wasm.call, ...append_code.func_idx_leb128,
        wasm.drop,
        wasm.local$get, ...val,
        wasm.i64$const, 8,
        wasm.i64$shr_u,
        wasm.local$set, ...val,
        wasm.local$get, ...cnt,
        wasm.i32$const, 1,
        wasm.i32$sub,
        wasm.local$tee, ...cnt,
        wasm.br_if, 0,
      wasm.end,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

const emit_int_literal = func_builder(function (_func) {
  const func = _func.param(wasm.i32),
        args = _func.param(wasm.i32),
        num = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...args,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$tee, ...num,
    wasm.call, ...types.Int.predicate_leb128,
    wasm.if, wasm.i32,
      wasm.local$get, ...func,
      wasm.i32$const, ...leb128(wasm.i64$const),
      wasm.call, ...append_code.func_idx_leb128,
      wasm.local$get, ...num,
      wasm.call, ...types.Int.fields.value.leb128,
      wasm.call, ...append_varsint64.func_idx_leb128,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

// todo: replace with a map of cases
const emit_code_special_form = func_builder(function (_func) {
  const head = _func.param(wasm.i32),
        args = _func.param(wasm.i32),
        func = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        xpt = _func.local(wasm.i32),
        macro = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...head,
    wasm.i32$const, ...leb128(make_symbol("fn")),
    wasm.i32$eq,
    wasm.local$get, ...head,
// todo: set export with metadata instead
    wasm.i32$const, ...leb128(make_symbol("export-fn")),
    wasm.i32$eq,
    wasm.local$tee, ...xpt,
    wasm.i32$or,
    wasm.local$get, ...head,
    wasm.i32$const, ...leb128(make_symbol("macro")),
    wasm.i32$eq,
    wasm.local$tee, ...macro,
    wasm.i32$or,
    wasm.if, wasm.i32,
      wasm.local$get, ...func,
      wasm.i32$const, ...leb128(wasm.i32$const),
      wasm.call, ...append_code.func_idx_leb128,
      wasm.local$get, ...xpt,
      wasm.local$get, ...macro,
      wasm.local$get, ...args,
      wasm.local$get, ...env,
      wasm.call, ...comp_func.func_idx_leb128,
      wasm.call, ...append_varsint32.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...head,
      wasm.i32$const, ...leb128(make_symbol("let")),
      wasm.i32$eq,
      wasm.if, wasm.i32,
        wasm.local$get, ...func,
        wasm.local$get, ...args,
        wasm.local$get, ...env,
        wasm.call, ...comp_func_add_let.func_idx_leb128,
      wasm.else,
        wasm.local$get, ...head,
        wasm.i32$const, ...leb128(make_symbol("if")),
        wasm.i32$eq,
        wasm.if, wasm.i32,
          wasm.local$get, ...func,
          wasm.local$get, ...args,
          wasm.local$get, ...env,
          wasm.call, ...comp_func_add_if.func_idx_leb128,
        wasm.else,
          wasm.local$get, ...head,
          wasm.i32$const, ...leb128(make_symbol("do")),
          wasm.i32$eq,
          wasm.if, wasm.i32,
            wasm.local$get, ...func,
            wasm.local$get, ...args,
            wasm.local$get, ...env,
            wasm.i32$const, ...leb128(wasm.block),
            wasm.call, ...comp_func_add_block.func_idx_leb128,
          wasm.else,
            wasm.local$get, ...head,
            wasm.i32$const, ...leb128(make_symbol("loop")),
            wasm.i32$eq,
            wasm.if, wasm.i32,
              wasm.local$get, ...func,
              wasm.local$get, ...args,
              wasm.local$get, ...env,
              wasm.call, ...comp_func_add_loop.func_idx_leb128,
            wasm.else,
              wasm.local$get, ...head,
              wasm.i32$const, ...leb128(make_symbol("throw")),
              wasm.i32$eq,
              wasm.if, wasm.i32,
                wasm.local$get, ...func,
                wasm.local$get, ...args,
                wasm.local$get, ...env,
                wasm.call, ...comp_func_add_throw.func_idx_leb128,
              wasm.else,
                wasm.local$get, ...head,
                wasm.i32$const, ...leb128(make_symbol("quote")),
                wasm.i32$eq,
                wasm.if, wasm.i32,
                  wasm.local$get, ...args,
                  wasm.call, ...first.func_idx_leb128,
                  wasm.local$get, ...func,
                  wasm.local$get, ...env,
                  wasm.call, ...emit_code_default.func_idx_leb128,
                wasm.else,
                  wasm.local$get, ...head,
                  wasm.i32$const, ...leb128(make_symbol("set-local")),
                  wasm.i32$eq,
                  wasm.if, wasm.i32,
                    wasm.local$get, ...func,
                    wasm.local$get, ...args,
                    wasm.local$get, ...env,
                    wasm.call, ...comp_func_add_set_local.func_idx_leb128,
                  wasm.else,
                    wasm.local$get, ...head,
                    wasm.i32$const, ...leb128(make_symbol("recur")),
                    wasm.i32$eq,
                    wasm.if, wasm.i32,
                      wasm.local$get, ...func,
                      wasm.local$get, ...args,
                      wasm.local$get, ...env,
                      wasm.call, ...comp_func_add_recur.func_idx_leb128,
                    wasm.else,
                      wasm.local$get, ...head,
                      wasm.i32$const, ...leb128(make_symbol("Int", "value")),
                      wasm.i32$eq,
                      wasm.if, wasm.i32,
                        wasm.local$get, ...func,
                        wasm.local$get, ...args,
                        wasm.call, ...emit_int_literal.func_idx_leb128,
                      wasm.else,
                        wasm.local$get, ...head,
                        wasm.i32$const, ...leb128(make_symbol("Float", "value")),
                        wasm.i32$eq,
                        wasm.if, wasm.i32,
                          wasm.local$get, ...func,
                          wasm.local$get, ...args,
                          wasm.call, ...emit_float_literal.func_idx_leb128,
                        wasm.else,
                          wasm.i32$const, 0,
                        wasm.end,
                      wasm.end,
                    wasm.end,
                  wasm.end,
                wasm.end,
              wasm.end,
            wasm.end,
          wasm.end,
        wasm.end,
      wasm.end,
    wasm.end
  );
});

const stage_arg = func_builder(function (_func) {
  const locals_to_free = _func.param(wasm.i32),
        locals_to_free_idx = _func.param(wasm.i32),
        args_list = _func.param(wasm.i32),
        func = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        arg = _func.local(wasm.i32),
        bef = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...args_list,
    wasm.call, ...first.func_idx_leb128,
    wasm.local$tee, ...arg,
    wasm.local$get, ...func,
    wasm.local$get, ...env,
    wasm.call, ...emit_code.func_idx_leb128,
    wasm.drop,
    wasm.local$get, ...arg,
    wasm.local$get, ...env,
    wasm.call, ...is_num64.func_idx_leb128,
    wasm.if, wasm.i32,
      wasm.local$get, ...locals_to_free_idx,
    wasm.else,
      wasm.local$get, ...env,
      wasm.call, ...locals_array.func_idx_leb128,
      wasm.call, ...types.Array.fields.length.leb128,
      wasm.local$set, ...bef,
      wasm.local$get, ...func,
      wasm.i32$const, ...leb128(wasm.call),
      wasm.call, ...append_code.func_idx_leb128,
      wasm.i32$const, ...off_local_refs.func_idx_leb128,
      wasm.call, ...append_varuint32.func_idx_leb128,
      wasm.drop,
      wasm.local$get, ...arg,
      wasm.call, ...is_seq.func_idx_leb128,
      wasm.i32$eqz,
      wasm.if, wasm.void,
        wasm.local$get, ...func,
        wasm.i32$const, ...leb128(wasm.local$tee),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.local$get, ...env,
        wasm.local$get, ...func,
        wasm.i32$const, 1,
        wasm.i32$const, ...leb128(wasm.i32),
        wasm.call, ...inc_locals.func_idx_leb128,
        wasm.local$get, ...env,
        wasm.i32$const, ...leb128(wasm.i32),
        wasm.call, ...add_local_to_free.func_idx_leb128,
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.drop,
      wasm.end,
      wasm.local$get, ...env,
      wasm.call, ...locals_array.func_idx_leb128,
      wasm.call, ...types.Array.fields.length.leb128,
      wasm.local$get, ...bef,
      wasm.i32$lt_u,
      wasm.if, wasm.i32,
        wasm.local$get, ...locals_to_free,
        wasm.local$get, ...locals_to_free_idx,
        wasm.local$get, ...bef,
        wasm.call, ...array_set_i32.func_idx_leb128,
        wasm.drop,
        wasm.local$get, ...locals_to_free_idx,
        wasm.i32$const, 1,
        wasm.i32$add,
      wasm.else,
        wasm.local$get, ...locals_to_free_idx,
      wasm.end,
    wasm.end
  );
});

const quote_form = func_builder(function (func) {
  const form = func.param(wasm.i32),
        sym = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.i32$const, 2,
    wasm.call, ...refs_array_by_length.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.local$get, ...sym,
    wasm.call, ...refs_array_set.func_idx_leb128,
    wasm.i32$const, 1,
    wasm.local$get, ...form,
    wasm.call, ...refs_array_set.func_idx_leb128,
    wasm.call, ...vector_seq_from_array.func_idx_leb128,
  );
});

const emit_macro = func_builder(function (_func) {
  const form = _func.param(wasm.i32),
        func = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        new_form = _func.local(wasm.i32),
        idx = _func.local(wasm.i32);
  _func.append_code(
    wasm.local$get, ...form,
    wasm.local$get, ...form,
    wasm.call, ...types.VectorSeq.fields.count.leb128,
    wasm.call, ...refs_array_by_length.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.local$get, ...form,
    wasm.call, ...first.func_idx_leb128,
    wasm.call, ...refs_array_set.func_idx_leb128,
    wasm.local$set, ...new_form,
    wasm.loop, wasm.i32,
// todo: free each form:
      wasm.local$get, ...form,
      wasm.call, ...rest.func_idx_leb128,
      wasm.local$tee, ...form,
      wasm.call, ...types.VectorSeq.fields.count.leb128,
      wasm.if, wasm.i32,
        wasm.local$get, ...new_form,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$tee, ...idx,
        wasm.local$get, ...form,
        wasm.call, ...first.func_idx_leb128,
        wasm.i32$const, ...leb128(make_symbol("quote")),
        wasm.call, ...quote_form.func_idx_leb128,
        wasm.call, ...refs_array_set.func_idx_leb128,
        wasm.br, 1,
      wasm.else,
        wasm.local$get, ...new_form,
      wasm.end,
    wasm.end,
    wasm.call, ...vector_seq_from_array.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...compile_form.func_idx_leb128,
    wasm.local$get, ...func,
    wasm.local$get, ...env,
    wasm.call, ...emit_code.func_idx_leb128,
    wasm.drop,
    wasm.call, ...free.func_idx_leb128
  );
});

emit_code.implement(types.Vector, function (_func) {
  const vec = _func.param(wasm.i32),
        func = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        idx = _func.local(wasm.i32),
        cnt = _func.local(wasm.i32),
        out = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...func,
    wasm.i32$const, ...leb128(wasm.i32$const),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.count.leb128,
    wasm.local$tee, ...cnt,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.call),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, ...refs_array_by_length.func_idx_leb128,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.loop, wasm.void,
      wasm.local$get, ...idx,
      wasm.local$get, ...cnt,
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        wasm.local$get, ...vec,
        wasm.local$get, ...idx,
        wasm.i32$const, nil,
        wasm.call, ...nth.func_idx_leb128,
        wasm.local$get, ...func,
        wasm.i32$const, ...leb128(wasm.i32$const),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.local$get, ...idx,
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.local$get, ...env,
        wasm.call, ...emit_code.func_idx_leb128,
        wasm.i32$const, ...leb128(wasm.call),
        wasm.call, ...append_code.func_idx_leb128,
        wasm.i32$const, ...refs_array_set.func_idx_leb128,
        wasm.call, ...append_varuint32.func_idx_leb128,
        wasm.drop,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$set, ...idx,
        wasm.br, 1,
      wasm.end,
    wasm.end,
    wasm.i32$const, ...leb128(wasm.call),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, ...vector_from_array.func_idx_leb128,
    wasm.call, ...append_varuint32.func_idx_leb128
  );
});

const emit_code_num64 = func_builder(function (_func) {
  const op = _func.param(wasm.i32),
        args = _func.param(wasm.i32),
        func = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        ns = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...op,
    wasm.call, ...types.Symbol.fields.namespace.leb128,
    wasm.local$tee, ...ns,
    wasm.call, ...types.String.predicate_leb128,
    wasm.if, wasm.i32,
      wasm.local$get, ...ns,
      wasm.i32$const, ...leb128(make_string("i64")),
      wasm.call, ...equiv.func_idx_leb128,
      wasm.local$get, ...ns,
      wasm.i32$const, ...leb128(make_string("f64")),
      wasm.call, ...equiv.func_idx_leb128,
      wasm.i32$or,
      wasm.if, wasm.i32,
        wasm.loop, wasm.void,
          wasm.local$get, ...args,
          wasm.call, ...types.VectorSeq.fields.count.leb128,
          wasm.if, wasm.void,
            wasm.local$get, ...args,
            wasm.call, ...first.func_idx_leb128,
            wasm.local$get, ...func,
            wasm.local$get, ...env,
            wasm.call, ...emit_code.func_idx_leb128,
            wasm.drop,
            wasm.local$get, ...args,
            wasm.local$get, ...args,
            wasm.call, ...rest.func_idx_leb128,
            wasm.local$set, ...args,
            wasm.call, ...free.func_idx_leb128,
            wasm.br, 1,
          wasm.end,
        wasm.end,
        wasm.local$get, ...func,
        wasm.local$get, ...ns,
        wasm.call, ...store_string.func_idx_leb128,
        wasm.local$get, ...op,
        wasm.call, ...types.Symbol.fields.name.leb128,
        wasm.call, ...store_string.func_idx_leb128,
        wasm.call, ...get_op_code.func_idx_leb128,
        wasm.call, ...append_code.func_idx_leb128,
      wasm.else,
        wasm.i32$const, 0,
      wasm.end,
    wasm.else,
      wasm.i32$const, 0,
    wasm.end
  );
});

// todo: special forms should also be stored in local for freeing
emit_code.implement(types.VectorSeq, function (_func) {
  const list = _func.param(wasm.i32),
        func = _func.param(wasm.i32),
        env = _func.param(wasm.i32),
        list_head = _func.local(wasm.i32),
        func_record = _func.local(wasm.i32),
        num_args = _func.local(wasm.i32),
        args_list = _func.local(wasm.i32),
        result = _func.local(wasm.i32),
        curr_local = _func.local(wasm.i32),
        locals_to_free = _func.local(wasm.i32),
        locals_to_free_idx = _func.local(wasm.i32);
  _func.add_result(wasm.i32);
  _func.append_code(
    wasm.local$get, ...list,
    wasm.i32$const, ...leb128(empty_vector_seq),
    wasm.i32$eq,
    wasm.if, wasm.void,
// don't need to store in local bc doesn't free
      wasm.local$get, ...func,
      wasm.i32$const, ...leb128(wasm.i32$const),
      wasm.call, ...append_code.func_idx_leb128,
      wasm.local$get, ...list,
      wasm.call, ...append_varsint32.func_idx_leb128,
      wasm.drop,
    wasm.else,
      wasm.local$get, ...list,
      wasm.call, ...first.func_idx_leb128,
      wasm.local$tee, ...list_head,
      wasm.local$get, ...list,
      wasm.call, ...rest.func_idx_leb128,
      wasm.local$tee, ...args_list,
      wasm.local$get, ...func,
      wasm.local$get, ...env,
      wasm.call, ...emit_code_special_form.func_idx_leb128,
// special forms need to decide whether to store in local & free
      wasm.i32$eqz,
      wasm.if, wasm.void,
        wasm.local$get, ...list_head,
        wasm.local$get, ...args_list,
        wasm.local$get, ...func,
        wasm.local$get, ...env,
        wasm.call, ...emit_code_num64.func_idx_leb128,
        wasm.i32$eqz,
        wasm.if, wasm.void,
          wasm.local$get, ...list_head,
          wasm.call, ...lookup_ref.func_idx_leb128,
          wasm.local$tee, ...func_record,
          wasm.call, ...types.Function.predicate_leb128,
          wasm.local$get, ...func_record,
          wasm.call, ...types.Function.fields.macro.leb128,
          wasm.i32$and,
          wasm.local$get, ...env,
          wasm.i32$const, ...leb128(make_keyword("run-macros")),
          wasm.i32$const, nil,
          wasm.call, ...get.func_idx_leb128,
          wasm.call, ...types.Boxedi32.fields.value.leb128,
          wasm.i32$and,
          wasm.if, wasm.void,
            wasm.local$get, ...list,
            wasm.local$get, ...func,
            wasm.local$get, ...env,
            wasm.call, ...emit_macro.func_idx_leb128,
          wasm.else,
            wasm.local$get, ...args_list,
            wasm.call, ...types.VectorSeq.fields.count.leb128,
            wasm.call, ...array_by_length.func_idx_leb128,
            wasm.local$set, ...locals_to_free,
            wasm.loop, wasm.void,
              wasm.local$get, ...args_list,
              wasm.call, ...types.VectorSeq.fields.count.leb128,
              wasm.if, wasm.void,
                wasm.local$get, ...locals_to_free,
                wasm.local$get, ...locals_to_free_idx,
                wasm.local$get, ...args_list,
                wasm.local$get, ...func,
                wasm.local$get, ...env,
                wasm.call, ...stage_arg.func_idx_leb128,
                wasm.local$set, ...locals_to_free_idx,
                wasm.local$get, ...args_list,
                wasm.local$get, ...args_list,
                wasm.call, ...rest.func_idx_leb128,
                wasm.local$set, ...args_list,
                wasm.call, ...free.func_idx_leb128,
                wasm.br, 1,
              wasm.end,
            wasm.end,
            wasm.local$get, ...func,
            wasm.i32$const, ...leb128(wasm.call),
            wasm.call, ...append_code.func_idx_leb128,
            wasm.local$get, ...func_record,
            wasm.call, ...types.Method.predicate_leb128,
            wasm.if, wasm.i32,
              wasm.i32$const, ...leb128(wasm.i32),
              wasm.local$set, ...result,
              wasm.local$get, ...func_record,
              wasm.call, ...types.Method.fields.main_func.leb128,
            wasm.else,
              wasm.local$get, ...func_record,
              wasm.call, ...types.Function.fields.result.leb128,
              wasm.local$set, ...result,
              wasm.local$get, ...func_record,
              wasm.call, ...types.Function.fields.func_num.leb128,
            wasm.end,
            wasm.call, ...append_varuint32.func_idx_leb128,
            wasm.drop,
            wasm.loop, wasm.void,
              wasm.local$get, ...locals_to_free_idx,
              wasm.if, wasm.void,
                wasm.local$get, ...func,
                wasm.i32$const, ...leb128(wasm.local$get),
                wasm.call, ...append_code.func_idx_leb128,
                wasm.local$get, ...locals_to_free,
                wasm.local$get, ...locals_to_free_idx,
                wasm.i32$const, 1,
                wasm.i32$sub,
                wasm.local$tee, ...locals_to_free_idx,
                wasm.call, ...array_get_i32.func_idx_leb128,
                wasm.call, ...append_varsint32.func_idx_leb128,
                wasm.i32$const, ...leb128(wasm.call),
                wasm.call, ...append_code.func_idx_leb128,
                wasm.i32$const, ...on_local_refs.func_idx_leb128,
                wasm.call, ...append_varsint32.func_idx_leb128,
                wasm.br, 1,
              wasm.end,
            wasm.end,
            wasm.local$get, ...locals_to_free,
            wasm.call, ...free.func_idx_leb128,
            wasm.local$get, ...result,
            wasm.i32$const, ...leb128(wasm.i32),
            wasm.i32$eq,
            wasm.if, wasm.void,
              wasm.local$get, ...func,
              wasm.i32$const, ...leb128(wasm.call),
              wasm.call, ...append_code.func_idx_leb128,
              wasm.i32$const, ...inc_refs.func_idx_leb128,
              wasm.call, ...append_varsint32.func_idx_leb128,
              wasm.i32$const, ...leb128(wasm.local$tee),
              wasm.call, ...append_code.func_idx_leb128,
              wasm.local$get, ...env,
              wasm.local$get, ...func,
              wasm.i32$const, 1,
              wasm.local$get, ...result,
              wasm.call, ...inc_locals.func_idx_leb128,
              wasm.local$get, ...env,
              wasm.local$get, ...result,
              wasm.call, ...add_local_to_free.func_idx_leb128,
              wasm.call, ...append_varuint32.func_idx_leb128,
              wasm.drop,
            wasm.end,
          wasm.end,
        wasm.end,
      wasm.end,
    wasm.end,
    // wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...func
  );
});

/*-----------*\
|             |
| expand-form |
|             |
\*-----------*/

const expand_form = new_method("expand-form", 1, wasm.i32, function (func) {
  const form = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.local$get, ...form);
});

/*------------*\
|              |
| syntax-quote |
|              |
\*------------*/

const syntax_quote = new_method("syntax-quote", 1, wasm.i32, function (func) {
  const form = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(wasm.local$get, ...form);
});

syntax_quote.implement(types.VectorSeq, function (func) {
  const seq = func.param(wasm.i32),
        idx = func.local(wasm.i32),
        out = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...seq,
    wasm.call, ...first.func_idx_leb128,
    wasm.i32$const, ...leb128(make_symbol("unquote")),
    wasm.i32$eq,
    wasm.if, wasm.i32,
      wasm.local$get, ...seq,
      wasm.call, ...types.VectorSeq.fields.vec.leb128,
      wasm.i32$const, 1,
      wasm.i32$const, nil,
      wasm.call, ...nth.func_idx_leb128,
    wasm.else,
      wasm.i32$const, ...leb128(empty_vector_seq),
      wasm.local$set, ...out,
      wasm.loop, wasm.void,
        wasm.local$get, ...seq,
        wasm.i32$const, ...leb128(empty_vector_seq),
        wasm.i32$ne,
        wasm.if, wasm.void,
          wasm.i32$const, ...leb128(empty_vector_seq),
          wasm.i32$const, ...leb128(make_symbol("conj")),
          wasm.call, ...conj.func_idx_leb128,
          wasm.local$get, ...out,
          wasm.call, ...conj.func_idx_leb128,
          wasm.local$get, ...seq,
          wasm.call, ...first.func_idx_leb128,
          wasm.call, ...syntax_quote.func_idx_leb128,
          wasm.call, ...conj.func_idx_leb128,
          wasm.local$set, ...out,
          wasm.local$get, ...seq,
          wasm.call, ...rest.func_idx_leb128,
          wasm.local$set, ...seq,
          wasm.br, 1,
        wasm.end,
      wasm.end,
      wasm.local$get, ...seq,
      wasm.call, ...free.func_idx_leb128,
      wasm.local$get, ...out,
    wasm.end
  );
});

// todo: namespace & gensym
syntax_quote.implement(types.Symbol, function (func) {
  const sym = func.param(wasm.i32),
        idx = func.local(wasm.i32),
        out = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.i32$const, ...leb128(empty_vector_seq),
    wasm.i32$const, ...leb128(make_symbol("symbol")),
    wasm.call, ...conj.func_idx_leb128,
    wasm.local$tee, ...out,
    wasm.local$get, ...out,
    wasm.local$get, ...sym,
    wasm.call, ...types.Symbol.fields.namespace.leb128,
    wasm.call, ...conj.func_idx_leb128,
    wasm.local$set, ...out,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...out,
    wasm.local$get, ...out,
    wasm.local$get, ...sym,
    wasm.call, ...types.Symbol.fields.name.leb128,
    wasm.call, ...conj.func_idx_leb128,
    wasm.local$set, ...out,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...out
  );
});

/*------------*\
|              |
| compile-form |
|              |
\*------------*/

const new_env = func_builder(function (func) {
  const run_macros = func.param(wasm.i32),
        addr = func.local(wasm.i32),
        offset = func.local(wasm.i32),
        env = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.i32$const, ...leb128(empty_hash_map),
    wasm.i32$const, ...leb128(make_keyword("run-macros")),
    wasm.local$get, ...run_macros,
    wasm.call, ...types.Boxedi32.constr.leb128,
    wasm.call, ...assoc.func_idx_leb128,
    wasm.local$tee, ...env,
    wasm.i32$const, ...leb128(make_keyword("locals")),
    wasm.i32$const, 0,
    wasm.call, ...array_by_length.func_idx_leb128,
    wasm.call, ...types.Boxedi32.constr.leb128,
    wasm.call, ...assoc.func_idx_leb128,
    wasm.local$get, ...env,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$tee, ...env,
    wasm.i32$const, ...leb128(make_keyword("locals-to-free")),
    wasm.i32$const, 0,
    wasm.call, ...array_by_length.func_idx_leb128,
    wasm.call, ...types.Boxedi32.constr.leb128,
    wasm.call, ...assoc.func_idx_leb128,
    wasm.local$get, ...env,
    wasm.call, ...free.func_idx_leb128
  );
});

compile_form.build(function (func) {
  const form = func.param(wasm.i32),
        run_macros = func.param(wasm.i32),
        out = func.local(wasm.i32),
        env = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.set_export("compile_form");
  func.append_code(
    wasm.local$get, ...form,
    // wasm.call, ...expand_form.func_idx_leb128,
    wasm.call, ...start_func.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32$const),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 4,
    wasm.call, ...alloc.func_idx_leb128,
    wasm.local$tee, ...out,
    wasm.call, ...append_varsint32.func_idx_leb128,
    wasm.local$get, ...run_macros,
    wasm.call, ...new_env.func_idx_leb128,
    wasm.local$tee, ...env,
    wasm.call, ...emit_code.func_idx_leb128,
//wasm.i32$const, ...leb128(wasm.local$tee),
//wasm.call, ...append_code.func_idx_leb128,
//wasm.i32$const, 0,
//wasm.call, ...append_code.func_idx_leb128,
//wasm.i32$const, ...leb128(wasm.local$get),
//wasm.call, ...append_code.func_idx_leb128,
//wasm.i32$const, 0,
//wasm.call, ...append_code.func_idx_leb128,
//wasm.i32$const, ...leb128(wasm.call),
//wasm.call, ...append_code.func_idx_leb128,
//wasm.i32$const, ...leb128(to_js.func_idx),
//wasm.call, ...append_varsint32.func_idx_leb128,
//wasm.i32$const, ...leb128(wasm.call),
//wasm.call, ...append_code.func_idx_leb128,
//wasm.i32$const, ...leb128(print_obj.func_idx),
//wasm.call, ...append_varsint32.func_idx_leb128,
    wasm.i32$const, ...leb128(wasm.i32$store),
    wasm.call, ...append_code.func_idx_leb128,
    wasm.i32$const, 2,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.call, ...append_varuint32.func_idx_leb128,
    wasm.call, ...end_func.func_idx_leb128,
    wasm.call, ...add_to_start_func.func_idx_leb128,
    wasm.local$get, ...env,
    wasm.call, ...free.func_idx_leb128,
    wasm.call, ...compile.func_idx_leb128,
// todo: need double compile?
    // wasm.call, ...compile.func_idx_leb128,
// todo: free out
    wasm.local$get, ...out,
    wasm.i32$load, 2, 0,
    wasm.local$get, ...out,
    wasm.i32$const, 4,
    wasm.call, ...free_mem.func_idx_leb128
  );
});

/*------------*\
|              |
| parsing text |
|              |
\*------------*/

// todo: review this section
function expand_switch (tgt, dft, ...clauses) {
  let out = dft,
      len = clauses.length;
  for (let i = 0; i < len; i += 2) {
    out = [
      wasm.local$get, ...tgt,
      ...clauses[len - i - 2],
      wasm.i32$eq,
      wasm.if, wasm.i32,
        ...clauses[len - i - 1],
      wasm.else,
        ...out,
      wasm.end
    ];
  }
  return out;
}

const is_line_terminator = func_builder(function (func) {
  const chr = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    ...expand_switch(
      chr, [wasm.i32$const, 0],
      // https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-line-terminators
      // LINE FEED
      [wasm.i32$const, ...leb128(0xa)], [wasm.i32$const, 2],
      // CARRIAGE RETURN
      [wasm.i32$const, ...leb128(0xd)], [wasm.i32$const, 2],
      // LINE SEPARATOR
      [wasm.i32$const, ...leb128(0x2028)], [wasm.i32$const, 2],
      // PARAGRAPH SEPARATOR
      [wasm.i32$const, ...leb128(0x2029)], [wasm.i32$const, 2]
    )
  );
});

const is_whitespace = func_builder(function (func) {
  const chr = func.param(wasm.i32),
        incl_line_term = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    ...expand_switch(
      chr, [
        wasm.local$get, ...incl_line_term,
        wasm.if, wasm.i32,
          wasm.local$get, ...chr,
          wasm.call, ...is_line_terminator.func_idx_leb128,
        wasm.else,
          wasm.i32$const, 0,
        wasm.end
      ],
      // https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-white-space
      // CHARACTER TABULATION <TAB>
      [wasm.i32$const, 0x9], [wasm.i32$const, 1],
      // LINE TABULATION <VT>
      [wasm.i32$const, 0xb], [wasm.i32$const, 1],
      // FORM FEED <FF>
      [wasm.i32$const, 0xc], [wasm.i32$const, 1],
      // ZERO WIDTH NO-BREAK SPACE <ZWNBSP>
      [wasm.i32$const, ...leb128(0xfeff)], [wasm.i32$const, 1],
      // https://util.unicode.org/UnicodeJsps/list-unicodeset.jsp?a=%5B:General_Category=Space_Separator:%5D
      // SPACE
      [wasm.i32$const, ...leb128(0x20)], [wasm.i32$const, 1],
      // NO-BREAK SPACE
      [wasm.i32$const, ...leb128(0xa0)], [wasm.i32$const, 1],
      // OGHAM SPACE MARK
      [wasm.i32$const, ...leb128(0x1680)], [wasm.i32$const, 1],
      // EN QUAD
      [wasm.i32$const, ...leb128(0x2000)], [wasm.i32$const, 1],
      // EM QUAD
      [wasm.i32$const, ...leb128(0x2001)], [wasm.i32$const, 1],
      // EN SPACE
      [wasm.i32$const, ...leb128(0x2002)], [wasm.i32$const, 1],
      // EM SPACE
      [wasm.i32$const, ...leb128(0x2003)], [wasm.i32$const, 1],
      // THREE-PER-EM SPACE
      [wasm.i32$const, ...leb128(0x2004)], [wasm.i32$const, 1],
      // FOUR-PER-EM SPACE
      [wasm.i32$const, ...leb128(0x2005)], [wasm.i32$const, 1],
      // SIX-PER-EM SPACE
      [wasm.i32$const, ...leb128(0x2006)], [wasm.i32$const, 1],
      // FIGURE SPACE
      [wasm.i32$const, ...leb128(0x2007)], [wasm.i32$const, 1],
      // PUNCTUATION SPACE
      [wasm.i32$const, ...leb128(0x2008)], [wasm.i32$const, 1],
      // THIN SPACE
      [wasm.i32$const, ...leb128(0x2009)], [wasm.i32$const, 1],
      // HAIR SPACE
      [wasm.i32$const, ...leb128(0x200A)], [wasm.i32$const, 1],
      // NARROW NO-BREAK SPACE
      [wasm.i32$const, ...leb128(0x202F)], [wasm.i32$const, 1],
      // MEDIUM MATHEMATICAL SPACE
      [wasm.i32$const, ...leb128(0x205F)], [wasm.i32$const, 1],
      // IDEOGRAPHIC SPACE
      [wasm.i32$const, ...leb128(0x3000)], [wasm.i32$const, 1]
    )
  );
});

const get_codepoint = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        org = func.local(wasm.i32),
        len = func.local(wasm.i32),
        num_bytes = func.local(wasm.i32),
        byt = func.local(wasm.i32),
        chr = func.local(wasm.i32),
        mask1 = 0b00011111,
        mask2 = 0b00001111,
        mask3 = 0b00000111;
  func.add_result(wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...idx,
    wasm.local$tee, ...org,
    wasm.local$get, ...str,
    wasm.call, ...string_length.func_idx_leb128,
    wasm.local$tee, ...len,
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.i32$const, 4,
    // this converts file to string
    wasm.call, ...substring.func_idx_leb128,
    wasm.call, ...types.String.fields.arr.leb128,
    wasm.local$set, ...str,
    wasm.i32$const, 0,
    wasm.local$set, ...idx,
    wasm.i32$lt_u,
    wasm.if, wasm.void,
      wasm.local$get, ...str,
      wasm.local$get, ...idx,
      wasm.call, ...array_get_i8.func_idx_leb128,
      wasm.local$tee, ...byt,
      wasm.i32$const, ...leb128(128),
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        wasm.local$get, ...byt,
        wasm.local$set, ...chr,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$set, ...idx,
      wasm.else,
        wasm.local$get, ...byt,
        wasm.i32$const, 5,
        wasm.i32$shr_u,
        wasm.i32$const, 0b110, 
        wasm.i32$eq,
        wasm.if, wasm.void,
          wasm.local$get, ...byt,
          wasm.i32$const, mask1,
          wasm.i32$and,
          wasm.local$set, ...chr,
          wasm.i32$const, 1,
          wasm.local$set, ...num_bytes,
        wasm.else,
          wasm.local$get, ...byt,
          wasm.i32$const, 4,
          wasm.i32$shr_u,
          wasm.i32$const, 0b1110,
          wasm.i32$eq,
          wasm.if, wasm.void,
            wasm.local$get, ...byt,
            wasm.i32$const, mask2,
            wasm.i32$and,
            wasm.local$set, ...chr,
            wasm.i32$const, 2,
            wasm.local$set, ...num_bytes,
          wasm.else,
            wasm.local$get, ...byt,
            wasm.i32$const, 3,
            wasm.i32$shr_u,
            wasm.i32$const, 0b11110,
            wasm.i32$eq,
            wasm.if, wasm.void,
              wasm.local$get, ...byt,
              wasm.i32$const, mask3,
              wasm.i32$and,
              wasm.local$set, ...chr,
              wasm.i32$const, 3,
              wasm.local$set, ...num_bytes,
            wasm.else,
              // todo: throw error
            wasm.end,
          wasm.end,
        wasm.end,
        wasm.local$get, ...idx,
        wasm.local$get, ...num_bytes,
        wasm.i32$add,
        wasm.local$get, ...len,
        wasm.i32$lt_u,
        wasm.if, wasm.void,
        // todo: else throw error
          wasm.loop, wasm.void,
            wasm.local$get, ...num_bytes,
            wasm.if, wasm.void,
              wasm.local$get, ...chr,
              wasm.i32$const, 6,
              wasm.i32$shl,
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.i32$const, 1,
              wasm.i32$add,
              wasm.local$tee, ...idx,
              wasm.call, ...array_get_i8.func_idx_leb128,
              wasm.i32$const, 0b00111111,
              wasm.i32$and,
              wasm.i32$or,
              wasm.local$set, ...chr,
              wasm.local$get, ...num_bytes,
              wasm.i32$const, 1,
              wasm.i32$sub,
              wasm.local$set, ...num_bytes,
              wasm.br, 1,
            wasm.else,
              wasm.local$get, ...idx,
              wasm.i32$const, 1,
              wasm.i32$add,
              wasm.local$set, ...idx,
            wasm.end,
          wasm.end,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.local$get, ...str,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...chr,
    wasm.local$get, ...org,
    wasm.local$get, ...idx,
    wasm.i32$add
  );
});

const trim_left = func_builder(function (func) {
  const str = func.param(wasm.i32),
        incl_newline = func.param(wasm.i32),
        idx = func.local(wasm.i32),
        chr = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.loop, wasm.void,
      wasm.local$get, ...str,
      wasm.local$get, ...idx,
      wasm.call, ...get_codepoint.func_idx_leb128,
      wasm.local$set, ...idx,
      wasm.local$tee, ...chr,
      wasm.if, wasm.void,
        wasm.local$get, ...chr,
        wasm.local$get, ...incl_newline,
        wasm.call, ...is_whitespace.func_idx_leb128,
        wasm.br_if, 1,
      wasm.end,
    wasm.end,
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.i32$const, 1,
    wasm.i32$sub,
    wasm.local$tee, ...idx,
    wasm.call, ...substring_to_end.func_idx_leb128
  );
});

/*-----*\
|       |
| throw |
|       |
\*-----*/

// todo: review this section
const throw_error = func_builder(function (func) {
  const msg = func.param(wasm.i32);
  func.append_code(
    wasm.local$get, ...msg,
    wasm.call, ...print_plain_string.func_idx_leb128,
    wasm.i32$const, def_exception("comp error"),
    wasm.i32$const, 0,
    wasm.throw, 0
  );
});

/*------------------------*\
|                          |
| parse & eval source code |
|                          |
\*------------------------*/

const read_form = func_builder();

// todo: review this section
const validate_boundary = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        chr = func.local(wasm.i32),
        after = func.local(wasm.i32),
        valid = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.call, ...get_codepoint.func_idx_leb128,
    wasm.local$set, ...after,
    wasm.local$tee, ...chr,
    wasm.i32$const, 1,
    wasm.call, ...is_whitespace.func_idx_leb128,
    wasm.if, wasm.i32,
      wasm.i32$const, 1,
    wasm.else,
      wasm.local$get, ...chr,
      wasm.i32$const, ...leb128("]".codePointAt(0)),
      wasm.i32$eq,
      wasm.if, wasm.i32,
        wasm.i32$const, 1,
      wasm.else,
        wasm.local$get, ...chr,
        wasm.i32$const, ...leb128(")".codePointAt(0)),
        wasm.i32$eq,
        wasm.if, wasm.i32,
          wasm.i32$const, 1,
        wasm.else,
          wasm.local$get, ...chr,
          wasm.i32$const, ...leb128("}".codePointAt(0)),
          wasm.i32$eq,
          wasm.if, wasm.i32,
            wasm.i32$const, 1,
          wasm.else,
            wasm.i32$const, 0,
          wasm.end,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.if, wasm.void,
      wasm.i32$const, 1,
      wasm.local$set, ...valid,
    wasm.else,
      wasm.local$get, ...after,
      wasm.local$set, ...idx,
    wasm.end,
    wasm.local$get, ...valid,
    wasm.local$get, ...idx
  );
});

const numeric_value_of_char = func_builder(function (func) {
  const chr = func.param(wasm.i32),
        base = func.param(wasm.i32),
        offset = func.param(wasm.i32),
        num = func.local(wasm.i32),
        valid = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i64);
  func.append_code(
    wasm.loop, wasm.void,
      wasm.local$get, ...chr,
      wasm.local$get, ...offset,
      wasm.i32$sub,
      wasm.local$tee, ...num,
      wasm.local$get, ...base,
      wasm.i32$lt_u,
      wasm.local$tee, ...valid,
      wasm.i32$eqz,
      wasm.if, wasm.void,
        wasm.local$get, ...base,
        wasm.i32$const, 10,
        wasm.i32$gt_u,
        wasm.local$get, ...chr,
        wasm.i32$const, ...leb128("a".codePointAt(0)),
        wasm.i32$ge_u,
        wasm.i32$and,
        wasm.if, wasm.void,
          wasm.local$get, ...chr,
          wasm.i32$const, 10,
          wasm.i32$add,
          wasm.local$set, ...chr,
          wasm.i32$const, ...leb128("a".codePointAt(0)),
          wasm.local$set, ...offset,
          wasm.br, 2,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.local$get, ...valid,
    wasm.local$get, ...num,
    wasm.i64$extend_i32_u
  );
});

const parse_number = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32),
        has_sign = func.param(wasm.i32),
        base = func.local(wasm.i64),
        chr = func.local(wasm.i32),
        digit = func.local(wasm.i64),
        num = func.local(wasm.i64),
        frc_div = func.local(wasm.f64),
        is_float = func.local(wasm.i32),
        exp = func.local(wasm.i64),
        is_exp = func.local(wasm.i32),
        tmp = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.f64$const, 0, 0, 0, 0, 0, 0, 0xf0, 0x3f, // 1
    wasm.local$set, ...frc_div,
    wasm.i64$const, 10,
    wasm.local$set, ...base,
    wasm.local$get, ...has_sign,
    wasm.if, wasm.void,
      wasm.local$get, ...str,
      wasm.local$get, ...idx,
      wasm.call, ...get_codepoint.func_idx_leb128,
      wasm.local$set, ...idx,
      wasm.i32$const, ...leb128(45),
      wasm.i32$eq,
      wasm.local$set, ...has_sign,
    wasm.end,
    wasm.loop, wasm.void,
      wasm.local$get, ...str,
      wasm.local$get, ...idx,
      wasm.local$tee, ...tmp,
      wasm.call, ...get_codepoint.func_idx_leb128,
      wasm.local$set, ...idx,
      wasm.local$tee, ...chr,
      wasm.local$get, ...base,
      wasm.i32$wrap_i64,
      wasm.i32$const, ...leb128("0".codePointAt(0)),
      wasm.call, ...numeric_value_of_char.func_idx_leb128,
      wasm.local$set, ...digit,
      wasm.if, wasm.void,
        wasm.local$get, ...is_exp,
        wasm.if, wasm.void,
          wasm.local$get, ...exp,
          wasm.i64$const, 10,
          wasm.i64$mul,
          wasm.local$get, ...digit,
          wasm.i64$add,
          wasm.local$set, ...exp,
          wasm.br, 2,
        wasm.else,
          wasm.local$get, ...is_float,
          wasm.if, wasm.void,
            wasm.local$get, ...frc_div,
            wasm.f64$const, 0, 0, 0, 0, 0, 0, 0x24, 0x40, // 10
            wasm.f64$mul,
            wasm.local$set, ...frc_div,
          wasm.end,
          wasm.local$get, ...num,
          wasm.local$get, ...base,
          wasm.i64$mul,
          wasm.local$get, ...digit,
          wasm.i64$add,
          wasm.local$set, ...num,
          wasm.br, 2,
        wasm.end,
      wasm.else,
        wasm.local$get, ...chr,
        wasm.i32$const, ...leb128("e".codePointAt(0)),
        wasm.i32$eq,
        wasm.local$get, ...is_exp,
        wasm.i32$eqz,
        wasm.i32$and,
        wasm.if, wasm.void,
          wasm.i32$const, 1,
          wasm.local$set, ...is_float,
          wasm.i32$const, 1,
          wasm.local$set, ...is_exp,
          wasm.br, 2,
        wasm.else,
          wasm.local$get, ...base,
          wasm.i64$const, 10,
          wasm.i64$eq,
          wasm.if, wasm.void,
            wasm.local$get, ...chr,
            wasm.i32$const, ...leb128(".".codePointAt(0)),
            wasm.i32$eq,
            wasm.local$get, ...is_float,
            wasm.i32$eqz,
            wasm.i32$and,
            wasm.if, wasm.void,
              wasm.i32$const, 1,
              wasm.local$set, ...is_float,
              wasm.br, 4,
            wasm.else,
              wasm.local$get, ...num,
              wasm.i64$eqz,
              wasm.if, wasm.void,
                wasm.local$get, ...chr,
                wasm.i32$const, ...leb128("x".codePointAt(0)),
                wasm.i32$eq,
                wasm.if, wasm.void,
                  wasm.i64$const, 16,
                  wasm.local$set, ...base,
                  wasm.br, 6,
                wasm.else,
                  wasm.local$get, ...chr,
                  wasm.i32$const, ...leb128("o".codePointAt(0)),
                  wasm.i32$eq,
                  wasm.if, wasm.void,
                    wasm.i64$const, 8,
                    wasm.local$set, ...base,
                    wasm.br, 7,
                  wasm.else,
                    wasm.local$get, ...chr,
                    wasm.i32$const, ...leb128("b".codePointAt(0)),
                    wasm.i32$eq,
                    wasm.if, wasm.void,
                      wasm.i64$const, 2,
                      wasm.local$set, ...base,
                      wasm.br, 8,
                    wasm.end,
                  wasm.end,
                wasm.end,
              wasm.end,
            wasm.end,
          wasm.end,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.local$get, ...has_sign,
    wasm.if, wasm.void,
      wasm.i64$const, 0,
      wasm.local$get, ...num,
      wasm.i64$sub,
      wasm.local$set, ...num,
    wasm.end,
    wasm.local$get, ...is_float,
    wasm.if, wasm.i32,
      wasm.local$get, ...num,
      wasm.f64$convert_i64_s,
      wasm.f64$const, 0, 0, 0, 0, 0, 0, 0x24, 0x40, // 10
      wasm.local$get, ...exp,
      wasm.call, ...pow.func_idx_leb128,
      wasm.f64$mul,
      wasm.local$get, ...frc_div,
      wasm.f64$div,
      wasm.call, ...types.Float.constr.leb128,
    wasm.else,
      wasm.local$get, ...num,
      wasm.call, ...types.Int.constr.leb128,
    wasm.end,
    wasm.local$get, ...tmp,
    wasm.local$get, ...lineno,
  );
});

const literal_tagged_data = new_method(null, 1, wasm.i32);

literal_tagged_data.implement(types.Int, function (func) {
  const int = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.i32$const, 2,
    wasm.call, ...refs_array_by_length.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.i32$const, ...leb128(make_symbol("Int", "value")),
    wasm.call, ...refs_array_set.func_idx_leb128,
    wasm.i32$const, 1,
    wasm.local$get, ...int,
    wasm.call, ...refs_array_set.func_idx_leb128,
    wasm.call, ...vector_seq_from_array.func_idx_leb128
  );
});

literal_tagged_data.implement(types.Float, function (func) {
  const flt = func.param(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.i32$const, 2,
    wasm.call, ...refs_array_by_length.func_idx_leb128,
    wasm.i32$const, 0,
    wasm.i32$const, ...leb128(make_symbol("Float", "value")),
    wasm.call, ...refs_array_set.func_idx_leb128,
    wasm.i32$const, 1,
    wasm.local$get, ...flt,
    wasm.call, ...refs_array_set.func_idx_leb128,
    wasm.call, ...vector_seq_from_array.func_idx_leb128
  );
});

literal_tagged_data.implement(types.Vector, function (func) {
  const vec = func.param(wasm.i32),
        arr = func.local(wasm.i32),
        len = func.local(wasm.i32),
        idx = func.local(wasm.i32),
        val = func.local(wasm.i32),
        out = func.local(wasm.i32);
  func.add_result(wasm.i32);
  func.append_code(
    wasm.local$get, ...vec,
    wasm.call, ...types.Vector.fields.tail.leb128,
    wasm.call, ...types.RefsArray.fields.arr.leb128,
    wasm.local$tee, ...arr,
    wasm.call, ...types.Array.fields.length.leb128,
    wasm.local$tee, ...len,
    wasm.i32$const, 2,
    wasm.i32$shl,
    wasm.call, ...array_by_length.func_idx_leb128,
    wasm.local$set, ...out,
    wasm.loop, wasm.void,
      wasm.local$get, ...idx,
      wasm.local$get, ...len,
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        wasm.local$get, ...arr,
        wasm.local$get, ...idx,
        wasm.call, ...array_get_i32.func_idx_leb128,
        wasm.local$tee, ...val,
        wasm.call, ...types.Int.predicate_leb128,
        wasm.if, wasm.void,
          wasm.local$get, ...out,
          wasm.local$get, ...idx,
          wasm.local$get, ...val,
          wasm.call, ...types.Int.fields.value.leb128,
          wasm.call, ...array_set_i64.func_idx_leb128,
          wasm.drop,
        wasm.else,
          wasm.local$get, ...val,
          wasm.call, ...types.Float.predicate_leb128,
          wasm.if, wasm.void,
            wasm.local$get, ...out,
            wasm.local$get, ...idx,
            wasm.local$get, ...val,
            wasm.call, ...types.Float.fields.value.leb128,
            wasm.call, ...array_set_f64.func_idx_leb128,
            wasm.drop,
          wasm.else,
            wasm.i32$const, 0,
            wasm.i32$const, 0,
            wasm.throw, 0,
          wasm.end,
        wasm.end,
        wasm.local$get, ...idx,
        wasm.i32$const, 1,
        wasm.i32$add,
        wasm.local$set, ...idx,
        wasm.br, 1,
      wasm.end,
    wasm.end,
    wasm.local$get, ...vec,
    wasm.call, ...free.func_idx_leb128,
    wasm.local$get, ...out
  );
});

const parse_tagged_data = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32),
        tag = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.local$tee, ...idx,
    wasm.local$get, ...lineno,
    wasm.call, ...read_form.func_idx_leb128,
    wasm.local$set, ...lineno,
    wasm.local$set, ...idx,
    wasm.local$tee, ...tag,
    wasm.call, ...types.Symbol.predicate_leb128,
    wasm.if, wasm.i32,
      wasm.local$get, ...tag,
      wasm.local$get, ...str,
      wasm.local$get, ...idx,
      wasm.local$get, ...lineno,
      wasm.call, ...read_form.func_idx_leb128,
      wasm.local$set, ...lineno,
      wasm.local$set, ...idx,
      wasm.call, ...types.TaggedData.constr.leb128,
    wasm.else,
      wasm.local$get, ...tag,
      wasm.call, ...literal_tagged_data.func_idx_leb128,
    wasm.end,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno
  );
});

// todo: symbol to map?
const parse_metadata = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32),
        meta = func.local(wasm.i32),
        data = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.local$tee, ...idx,
    wasm.local$get, ...lineno,
    wasm.call, ...read_form.func_idx_leb128,
    wasm.local$set, ...lineno,
    wasm.local$set, ...idx,
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno,
    wasm.call, ...read_form.func_idx_leb128,
    wasm.local$set, ...lineno,
    wasm.local$set, ...idx,
    wasm.call, ...types.Metadata.constr.leb128,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno
  );
});

function switch_string_match (str, idx, match_idx, ...clauses) {
  const clen = clauses.length;
  let out = [wasm.i32$const, 0];
  for (let c = 0; c < clen; c += 2) {
    const strs = clauses[clen - c - 2],
          len = strs.length;
    let inner_out = [wasm.i32$const, 0];
    for (let i = 0; i < len; i++) {
      let cmpr = strs[len - i - 1];
      if (typeof cmpr === "number") cmpr = String.fromCodePoint(cmpr);
      cmpr = make_string(cmpr);
      inner_out = [
        wasm.local$get, ...str,
        wasm.i32$const, ...leb128(cmpr),
        wasm.local$get, ...idx,
        wasm.call, ...string_matches_from.func_idx_leb128,
        wasm.if, wasm.i32,
          wasm.local$get, ...idx,
          wasm.i32$const, ...leb128(cmpr),
          wasm.call, ...string_length.func_idx_leb128,
          wasm.i32$add,
          wasm.local$tee, ...match_idx,
        wasm.else,
          ...inner_out,
        wasm.end,
      ];
    }
    out = [
      ...inner_out,
      wasm.if, wasm.i32,
        ...clauses[clen - c - 1],
      wasm.else,
        ...out,
      wasm.end
    ]
  }
  return out;
}

function range (start, end) {
  const out = [start];
  while (start <= end) out.push(start++);
  return out;
}

const symbol_start_chars = [
  "!", "$", "%", "&", "*", "+", "-", ".", "_", "|",
  ...range(48, 57), ...range(60, 63), ...range(65, 90),
  ...range(97, 122), ...range(192, 214), ...range(216, 246),
  ...range(248, 255)
];

const parse_symbol = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32),
        iskw = func.param(wasm.i32),
        org_idx = func.local(wasm.i32),
        match_idx = func.local(wasm.i32),
        chr = func.local(wasm.i32),
        ns = func.local(wasm.i32),
        nm_start = func.local(wasm.i32),
        nm = func.local(wasm.i32),
        autoresolve = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...idx,
    wasm.local$get, ...iskw,
    wasm.i32$add,
    wasm.local$tee, ...idx,
    wasm.local$tee, ...org_idx,
    wasm.local$set, ...nm_start,
    wasm.loop, wasm.void,
      ...switch_string_match(str, idx, match_idx,
        [":"],
        [
          wasm.local$get, ...iskw,
          wasm.local$get, ...org_idx,
          wasm.local$get, ...idx,
          wasm.i32$eq,
          wasm.i32$and,
          wasm.if, wasm.void,
            wasm.i32$const, 1,
            wasm.local$set, ...autoresolve,
            wasm.local$get, ...match_idx,
            wasm.local$tee, ...org_idx,
            wasm.local$set, ...nm_start,
          wasm.end,
          wasm.i32$const, 1
        ],
        ["#", "'", ...symbol_start_chars],
        [wasm.i32$const, 1],
        ["/"],
        [
          wasm.local$get, ...str,
          wasm.local$get, ...org_idx,
          wasm.local$get, ...idx,
          wasm.call, ...substring_until.func_idx_leb128,
          wasm.local$set, ...ns,
          wasm.local$get, ...match_idx,
          wasm.local$tee, ...nm_start,
        ]
      ),
      wasm.if, wasm.void,
	wasm.local$get, ...match_idx,
        wasm.local$set, ...idx,
        wasm.br, 1,
      wasm.end,
    wasm.end,
    wasm.local$get, ...str,
    wasm.local$get, ...nm_start,
    wasm.local$get, ...idx,
    wasm.call, ...substring_until.func_idx_leb128,
    wasm.local$set, ...nm,
    wasm.local$get, ...iskw,
    wasm.if, wasm.i32,
      wasm.local$get, ...ns,
      wasm.local$get, ...nm,
      wasm.call, ...new_keyword.func_idx_leb128,
    wasm.else,
      wasm.local$get, ...ns,
      wasm.i32$eqz,
      wasm.local$get, ...nm,
      wasm.i32$const, ...leb128(make_string("nil")),
      wasm.call, ...equiv.func_idx_leb128,
      wasm.i32$and,
      wasm.if, wasm.i32,
        wasm.i32$const, nil,
      wasm.else,
        wasm.local$get, ...ns,
        wasm.local$get, ...nm,
        wasm.call, ...new_symbol.func_idx_leb128,
      wasm.end,
    wasm.end,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno
  );
});

// todo: if all elements are literal, make it literal
// otherwise, construct at runtime
const parse_coll = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32),
        coll = func.param(wasm.i32),
        delim = func.param(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...idx,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.local$set, ...idx,
    wasm.loop, wasm.void,
      wasm.local$get, ...str,
      wasm.local$get, ...idx,
      wasm.call, ...get_codepoint.func_idx_leb128,
      wasm.drop,
      wasm.local$get, ...delim,
      wasm.i32$ne,
      wasm.if, wasm.void,
        wasm.local$get, ...coll,
        wasm.local$get, ...coll,
        wasm.local$get, ...str,
        wasm.local$get, ...idx,
        wasm.local$get, ...lineno,
        wasm.call, ...read_form.func_idx_leb128,
        wasm.local$set, ...lineno,
        wasm.local$set, ...idx,
        wasm.call, ...conj.func_idx_leb128,
        wasm.local$set, ...coll,
        wasm.call, ...free.func_idx_leb128,
        wasm.br, 1,
      wasm.end,
    wasm.end,
    wasm.local$get, ...coll,
    wasm.local$get, ...idx,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.local$get, ...lineno
  );
});

const parse_list = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno,
    wasm.i32$const, ...leb128(empty_vector_seq),
    wasm.i32$const, ...leb128(")".codePointAt(0)),
    wasm.call, ...parse_coll.func_idx_leb128
  );
});

const parse_vector = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno,
    wasm.i32$const, ...leb128(empty_vector),
    wasm.i32$const, ...leb128("]".codePointAt(0)),
    wasm.call, ...parse_coll.func_idx_leb128
  );
});

const parse_syntax_quote = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32),
        out = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.local$get, ...lineno,
    wasm.call, ...read_form.func_idx_leb128,
    wasm.local$set, ...lineno,
    wasm.local$set, ...idx,
    wasm.call, ...syntax_quote.func_idx_leb128,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno
  );
});

const parse_quote = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32),
        sym = func.param(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...str,
    wasm.local$get, ...idx,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.local$get, ...lineno,
    wasm.call, ...read_form.func_idx_leb128,
    wasm.local$set, ...lineno,
    wasm.local$set, ...idx,
    wasm.local$get, ...sym,
    wasm.call, ...quote_form.func_idx_leb128,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno
  );
});

const parse_comment = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32);
  func.add_result(wasm.i32, wasm.i32);
  func.append_code(
    wasm.loop, wasm.void,
      wasm.local$get, ...str,
      wasm.local$get, ...idx,
      wasm.call, ...get_codepoint.func_idx_leb128,
      wasm.local$set, ...idx,
      wasm.i32$const, "\n".codePointAt(0),
      wasm.i32$ne,
      wasm.br_if, 0,
    wasm.end,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno,
    wasm.i32$const, 1,
    wasm.i32$add
  );
});

const parse_string = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32),
        orig = func.local(wasm.i32),
        chr = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...idx,
    wasm.i32$const, 1,
    wasm.i32$add,
    wasm.local$tee, ...idx,
    wasm.local$set, ...orig,
    wasm.loop, wasm.void,
      wasm.local$get, ...str,
      wasm.local$get, ...idx,
      wasm.call, ...get_codepoint.func_idx_leb128,
      wasm.local$set, ...idx,
      wasm.local$tee, ...chr,
      wasm.i32$const, ...leb128('"'.codePointAt(0)),
      wasm.i32$ne,
      wasm.if, wasm.void,
        wasm.local$get, ...chr,
        wasm.i32$const, ...leb128("\\".codePointAt(0)),
        wasm.i32$eq,
        wasm.if, wasm.void,
          wasm.local$get, ...idx,
          wasm.i32$const, 1,
          wasm.i32$add,
          wasm.local$set, ...idx,
        wasm.else,
          wasm.local$get, ...chr,
          wasm.i32$const, ...leb128("\n".codePointAt(0)),
          wasm.i32$eq,
          wasm.if, wasm.void,
            wasm.local$get, ...lineno,
            wasm.i32$const, 1,
            wasm.i32$add,
            wasm.local$set, ...lineno,
          wasm.end,
        wasm.end,
        wasm.br, 1,
      wasm.end,
    wasm.end,
    wasm.local$get, ...str,
    wasm.local$get, ...orig,
    wasm.local$get, ...idx,
    wasm.i32$const, 1,
    wasm.i32$sub,
    wasm.call, ...substring_until.func_idx_leb128,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno
  );
});

read_form.build(function (func) {
  const str = func.param(wasm.i32),
        idx = func.param(wasm.i32),
        lineno = func.param(wasm.i32),
        org_idx = func.local(wasm.i32),
        match_idx = func.local(wasm.i32),
        out = func.local(wasm.i32),
        wts = func.local(wasm.i32),
        len = func.local(wasm.i32),
        chr = func.local(wasm.i32),
        tmp = func.local(wasm.i32);
  func.add_result(wasm.i32, wasm.i32, wasm.i32);
  func.append_code(
    wasm.local$get, ...idx,
    wasm.local$set, ...org_idx,
    wasm.local$get, ...str,
    wasm.call, ...string_length.func_idx_leb128,
    wasm.local$set, ...len,
    wasm.loop, wasm.void,
      wasm.local$get, ...idx,
      wasm.local$get, ...len,
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        wasm.local$get, ...str,
        wasm.local$get, ...idx,
        wasm.call, ...get_codepoint.func_idx_leb128,
        wasm.local$set, ...tmp,
        wasm.local$tee, ...chr,
        wasm.i32$const, 1,
        wasm.call, ...is_whitespace.func_idx_leb128,
        wasm.local$tee, ...wts,
        wasm.if, wasm.i32,
          wasm.local$get, ...tmp,
          wasm.local$set, ...idx,
          wasm.local$get, ...wts,
          wasm.i32$const, 2,
          wasm.i32$eq,
          wasm.if, wasm.void,
            wasm.local$get, ...lineno,
            wasm.i32$const, 1,
            wasm.i32$add,
            wasm.local$set, ...lineno,
          wasm.end,
          wasm.i32$const, 1,
        wasm.else,
          wasm.local$get, ...chr,
          wasm.i32$const, ...leb128(";".codePointAt(0)),
          wasm.i32$eq,
          wasm.if, wasm.i32,
            wasm.local$get, ...str,
            wasm.local$get, ...tmp,
            wasm.local$get, ...lineno,
            wasm.call, ...parse_comment.func_idx_leb128,
            wasm.local$set, ...lineno,
            wasm.local$set, ...idx,
            wasm.i32$const, 1,
          wasm.else,
            wasm.i32$const, 0,
          wasm.end,
        wasm.end,
        wasm.if, wasm.void,
          wasm.br, 2,
        wasm.else,
          ...switch_string_match(str, idx, match_idx,
            [
              "-0", "-1", "-2", "-3", "-4", "-5", "-6", "-7", "-8", "-9",
              "+0", "+1", "+2", "+3", "+4", "+5", "+6", "+7", "+8", "+9"
            ],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.i32$const, 1,
              wasm.call, ...parse_number.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx,
            ],
            ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9",],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.i32$const, 0,
              wasm.call, ...parse_number.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx,
            ],
            ['"'],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.call, ...parse_string.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx,
            ],
            [":"],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.i32$const, 1,
              wasm.call, ...parse_symbol.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx,
            ],
            symbol_start_chars,
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.i32$const, 0,
              wasm.call, ...parse_symbol.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx,
            ],
            ["("],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.call, ...parse_list.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx
            ],
            ["["],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.call, ...parse_vector.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx
            ],
            ["#"],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.call, ...parse_tagged_data.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx
            ],
            ["^"],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.call, ...parse_metadata.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx
            ],
            ["'"],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.i32$const, ...leb128(make_symbol("quote")),
              wasm.call, ...parse_quote.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx
            ],
            ["`"],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.call, ...parse_syntax_quote.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx
            ],
            ["~"],
            [
              wasm.local$get, ...str,
              wasm.local$get, ...idx,
              wasm.local$get, ...lineno,
              wasm.i32$const, ...leb128(make_symbol("unquote")),
              wasm.call, ...parse_quote.func_idx_leb128,
              wasm.local$set, ...lineno,
              wasm.local$set, ...idx
            ]
          ),
          wasm.local$get, ...str,
          wasm.local$get, ...idx,
          wasm.call, ...validate_boundary.func_idx_leb128,
          wasm.local$set, ...idx,
          wasm.i32$eqz,
          wasm.if, wasm.void,
            wasm.i32$const, ...leb128(make_string("[syntax error] invalid or unexpected token: ")),
            wasm.local$get, ...str,
            wasm.local$get, ...org_idx,
            wasm.local$get, ...idx,
            wasm.call, ...substring_until.func_idx_leb128,
            wasm.call, ...concat_str.func_idx_leb128,
            wasm.call, ...throw_error.func_idx_leb128,
          wasm.end,
          wasm.local$set, ...out,
        wasm.end,
      wasm.end,
    wasm.end,
    wasm.local$get, ...out,
    wasm.local$get, ...idx,
    wasm.local$get, ...lineno
  );
});

const print_lineno = func_builder(function (func) {
  const lineno = func.param(wasm.i32);
  func.append_code(
    wasm.i32$const, ...leb128(make_string("  line ")),
    wasm.local$get, ...lineno,
    wasm.call, ...i32_to_string.func_idx_leb128,
    wasm.call, ...concat_str.func_idx_leb128,
    wasm.call, ...print_plain_string.func_idx_leb128
  );
});

const eval_stream = func_builder(function (func) {
  const str = func.param(wasm.i32),
        idx = func.local(wasm.i32),
        out = func.local(wasm.i32),
        lineno = func.local(wasm.i32);
  func.set_export("eval_stream");
  func.append_code(
    wasm.i32$const, 1,
    wasm.local$set, ...lineno,
    wasm.loop, wasm.void,
      wasm.local$get, ...idx,
      wasm.local$get, ...str,
      wasm.call, ...string_length.func_idx_leb128,
      wasm.i32$lt_u,
      wasm.if, wasm.void,
        // wasm.try, wasm.void,
          wasm.local$get, ...str,
          wasm.local$get, ...idx,
          wasm.local$get, ...lineno,
          wasm.call, ...read_form.func_idx_leb128,
          wasm.local$set, ...lineno,
          wasm.local$set, ...idx,
          wasm.local$tee, ...out,
          wasm.i32$const, 1,
	  wasm.call, ...compile_form.func_idx_leb128,
          wasm.drop,
          //wasm.local$get, ...out,
          //wasm.call, ...free.func_idx_leb128,
          wasm.br, 1,
        // wasm.catch_all,
        //   wasm.local$get, ...lineno,
        //   wasm.call, ...print_lineno.func_idx_leb128,
        //   wasm.i32$const, def_exception("caught error"),
        //   wasm.i32$const, 0,
        //   wasm.throw, 0,
        // wasm.end,
      wasm.end,
    wasm.end
  );
});

// END COMP

const fs = require("fs");
const {minify} = require("uglify-js");

fs.writeFile("blah", build_package(), () => null);

compile();

// thread_port = comp.alloc(8);

/*------------*\
|              |
| Parse Syntax |
|              |
\*------------*/

// todo: review this section
/*
const boundaries = /^( |\n|;|\)|\]|\})/;

function parse (s, tgt, cb) {
  while (s.length && !s.match(boundaries)) {
    let _s;
    if (cb) _s = cb(s);
    if (_s) s = _s;
    else {
      const cont = tgt.pop();
      tgt.push(cont + s[0]);
      s = s.slice(1);
    }
  }
  return s;
}

function parse_symbol2 (s, accum) {
  let iskw = false, isns = false;
  if (s.startsWith(":")) {
    iskw = true;
    s = s.slice(1);
    if (s.startsWith(":")) {
      isns = true;
      s = s.slice(1);
    }
  }
  const content = [""];
  s = parse(s, content, function (s) {
    if (s.startsWith("/")) {
      content.push("");
      return s.slice(1);
    }
  });
  let ns = nil,
      nm = content[0],
      out;
  if (content.length === 2) {
    ns = content[0];
    nm = content[1];
  } else if (!iskw) {
    switch (nm) {
      case "true": out = comp_true; break;
    }
  }
  if (iskw) {
    ns = ns === nil ? ns : make_string(ns);
    nm = make_string(nm);
    out = comp.keyword(ns, nm);
  } else if (!ns && nm === "nil") {
    out = nil;
  } else if (!ns && nm === "false") {
    out = comp_false;
  } else if (!ns && nm === "true") {
    out = comp_true;
  } else {
    out = make_symbol(ns, nm);
  }
  accum.push(out);
  return s;
}

function parse_number2 (s, accum) {
  const content = [""];
  let is_float = false;
  s = parse(s, content, function (s) {
    if (s[0] === ".") is_float = true;
  });
  if (is_float) {
    const flt = parseFloat(content.pop());
    accum.push(comp.Float(flt));
  } else {
    accum.push(comp.Int(BigInt(content[0])));
  }
  return s;
};

function parse_list2 (s, accum, delim) {
  s = s.slice(1);
  const coll = [];
  while (!s.startsWith(delim)) {
    const len = coll.length;
    s = read_form(s, coll);
    if (coll.length > len) coll.unshift(coll.pop());
  }
  let len = 1, list = empty_list;
  for (const item of coll) {
    list = comp.List(len++, item, list);
  }
  accum.push(list);
  return s.slice(delim.length);
};

function parse_tagged (s, accum) {
  const content = [];
  s = read_form(s.slice(1), content);
  if (comp["types.Symbol/instance?"](content[0])) {
    s = read_form(s, content);
  } else {
    content.unshift(nil);
  }
  accum.push(comp.TaggedData(...content));
  return s;
};

function parse_meta (s, accum) {
  const content = [];
  s = read_form(s.slice(1), content);
  s = read_form(s, content);
  accum.push(comp.Metadata(...content));
  return s;
};

function parse_deref (s, accum) {
  const sym = new CompSymbol("deref"),
        content = [sym];
  s = read_form(s.slice(1), content);
  accum.push(new CompList(...content));
  return s;
};

function parse_quote (s, accum) {
  const tag = make_symbol(nil, "quote"),
        content = [tag];
  s = read_form(s.slice(1), content);
  accum.push(comp.TaggedData(...content));
  return s;
};

function parse_string (s, accum) {
  let str = "";
  s = s.slice(1);
  while (!s.startsWith('"')) {
    if (s.startsWith("\\")) {
      str += s[0];
      s = s.slice(1);
    }
    str += s[0];
    s = s.slice(1);
  }
  accum.push(make_string(str));
  return s.slice(1);
};

function parse_comment (s, accum) {
  let comment = "";
  while (!s.startsWith("\n") && s.length) {
    comment += s[0];
    s = s.slice(1);
  }
  return s;
};

function parse_noop (s, accum) {
  return read_form(s.slice(2), []);
};

/*---------*\
|           |
| read_form |
|           |
\*---------*/

/*
// todo: review this section
function read_form2 (s, accum) {
  let parser, delim;
  if (s.match(/^[-+]?[0-9]/)) {
    parser = parse_number;
  } else if (s.startsWith(":")) {
    parser = parse_symbol;
  } else if (s.startsWith("^")) {
    parser = parse_meta;
  } else if (s.startsWith("(")) {
    parser = parse_list;
    delim = ")";
  } else if (s.startsWith("[")) {
    // parser = SourceVector;
  } else if (s.startsWith("{")) {
    // parser = SourceMap;
  } else if (s.startsWith("@")) {
    parser = parse_deref;
  } else if (s.startsWith("'")) {
    parser = parse_quote;
  } else if (s.startsWith("`")) {
    // parser = SourceSyntaxQuote;
  } else if (s.startsWith('"')) {
    parser = parse_string;
  } else if (s.startsWith("#_")) {
    parser = parse_noop;
  } else if (s.startsWith("#")) {
    parser = parse_tagged;
  } else if (s.startsWith(";")) {
    parser = parse_comment;
  } else {
    parser = parse_symbol;
  }
  return parser(s, accum, delim).trimLeft();
}

/*-----------*\
|             |
| read_string |
|             |
\*-----------*/

// todo: review this section
/*
function read_forms (s) {
  const accum = [];
  s = s.trim();
  while (s.length) s = read_form(s, accum);
  return accum;
}

function read_string (s) {
  const forms = read_forms(s);
  return forms[forms.length - 1];
}

function eval_string (s) {
  s = s.trim();
  let out;
  while (s.length) {
    try {
      const accum = [];
      s = read_form(s, accum);
      // todo: free each out
// comp access
      if (accum[0]) out = comp.compile_form(accum[0]);
    } catch (e) {
      if (e instanceof WebAssembly.Exception && e.is(exception_tag)) {
        console.log(e.getArg(exception_tag, 0));
        // console.log(load_ref(e.getArg(exception_tag, 0)));
      }
      throw e;
    }
  }
  return (new DataView(memory.buffer)).getUint32(out, true);
  // todo: free last out
}
*/

function eval_file (f) {
  const fd = fs.openSync(f, "r");
  comp.eval_stream(comp.File(fd));
}

// todo: this is changing address 0 (nil)

// if (!main_env.is_main) {
//   const tgt = (new DataView(memory.buffer)).getUint32(main_env.thread_port, true);
//   // comp.add_watch(tgt);
// } else {
//   comp.watch(comp.Atom(nil), 3);
// }

// !!! package cut

// console.log(to_js(eval_string(`
// (def 'add (func _ (x y) (Int/new (i64/add (Int/value x) (Int/value y)))))
// (add 5 7)
// `)));

//const message_listener = spawn_thread(`
//const node_worker = require('node:worker_threads');
//node_worker.parentPort.on("message", function (mem) {
//  (function doWait (init) {
//    const buf = new Int32Array(mem.buffer);
//    Atomics.store(buf, ${(thread_port / 4) + 1}, 0);
//    Atomics.notify(buf, ${(thread_port / 4) + 1});
//    Atomics.wait(buf, ${thread_port / 4}, 0);
//    const new_val = Atomics.load(buf, ${thread_port / 4});
//    Atomics.store(buf, ${thread_port / 4}, 0);
//    node_worker.parentPort.postMessage(new_val + " " + ${thread_port});
//    doWait(new_val);
//  })(0);
//});
//`, { eval: true });

// start_thread();

if (!main_env.is_browser) {
  const argv = process.argv;
  if (argv[2] === "--compile") {
    try {
      eval_file(argv[3]);
    } catch (e) {
      console.log(e);
      return;
    }
  }
}

console.timeEnd("all");

}
