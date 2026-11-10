import snapshot from "./snapshot.json";
import annualData from "./annual-data.json";
export const cities = [...new Set([...snapshot.flow, ...snapshot.congestion, ...snapshot.weather].map(r => r.city))];
let seeding: Promise<void> | undefined;
export async function ensureSeed(db: D1Database) {
  if (!seeding) seeding = (async()=>{await seed(db);await seedAnnual(db);})().catch(error => { seeding = undefined; throw error; });
  return seeding;
}
async function seed(db: D1Database) {
  if (await db.prepare("SELECT id FROM seed_state WHERE id=?").bind("snapshot-v1").first()) return;
  const statements: D1PreparedStatement[] = [];
  for (const [table, rows] of Object.entries(snapshot)) {
    const columns = Object.keys(rows[0]);
    for (let i=0; i<rows.length; i+=8) {
      const chunk = rows.slice(i,i+8) as Record<string,unknown>[];
      const groups = chunk.map(() => `(${columns.map(()=>"?").join(",")})`).join(",");
      statements.push(db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(",")}) VALUES ${groups}`)
        .bind(...chunk.flatMap(row => columns.map(k => row[k] ?? null))));
    }
  }
  for (let i=0; i<statements.length; i+=80) await db.batch(statements.slice(i,i+80));
  await db.prepare("INSERT OR IGNORE INTO seed_state(id) VALUES (?)").bind("snapshot-v1").run();
}
async function seedAnnual(db:D1Database){
  const version="annual:"+annualData.data_revision;
  if(await db.prepare("SELECT id FROM seed_state WHERE id=?").bind(version).first())return;
  const statements:D1PreparedStatement[]=[];
  for(const [table,rows]of [["annual_sources",annualData.sources],["annual_metrics",annualData.records],["annual_missing",annualData.missing]] as [string,Record<string,unknown>[]][]){
    const columns=Object.keys(rows[0]),size=Math.max(1,Math.floor(90/columns.length));
    const updates=columns.filter(c=>c!=="id").map(c=>`${c}=excluded.${c}`).join(",");
    for(let i=0;i<rows.length;i+=size){const chunk=rows.slice(i,i+size);const groups=chunk.map(()=>`(${columns.map(()=>"?").join(",")})`).join(",");statements.push(db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${groups} ON CONFLICT(id) DO UPDATE SET ${updates}`).bind(...chunk.flatMap(row=>columns.map(c=>row[c]??null))));}
  }
  for(let i=0;i<statements.length;i+=60)await db.batch(statements.slice(i,i+60));
  await db.prepare("INSERT OR IGNORE INTO seed_state(id) VALUES(?)").bind(version).run();
}
export function safeSql(input: string) {
  let sql = input.trim().replace(/;\s*$/, "");
  if (sql.length>12000 || !/^(SELECT|WITH)\b/i.test(sql)) throw new Error("只允许只读 SELECT 查询。");
  // 只检查字符串外的语法；禁止多语句、写操作、系统表和扩展函数。
  const code=sql.replace(/'(?:''|[^'])*'/g,"''").replace(/--[^\n]*|\/\*[\s\S]*?\*\//g," ");
  if (/[;]/.test(code) || /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|CREATE|ALTER|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|RECURSIVE|LOAD_EXTENSION|READFILE|WRITEFILE)\b|\bsqlite_|\bpragma_/i.test(code)) throw new Error("查询包含不支持的操作或系统对象。");
  const ctes=[...code.matchAll(/(?:WITH|,)\s*([a-z_]\w*)\s+AS\s*\(/gi)].map(m=>m[1].toLowerCase());
  const tokens=code.match(/''|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]|[a-z_]\w*|[(),.]|\S/gi)||[];
  const contexts=[{from:false,expect:false}];let depth=0;
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i],word=token.replace(/^["`\[]|["`\]]$/g,"").toLowerCase(),ctx=contexts[depth];
    if(token==="("){if(ctx.expect)ctx.expect=false;depth++;contexts[depth]={from:false,expect:false};continue;}
    if(token===")"){if(depth>0)depth--;continue;}
    if(ctx.expect){if(!["flow","congestion","weather","annual_metrics","annual_sources","annual_missing",...ctes].includes(word)||tokens[i+1]===".")throw new Error("仅可查询已授权的交通业务表。");ctx.expect=false;continue;}
    if(/^(from|join)$/.test(word)){ctx.from=true;ctx.expect=true;}
    else if(/^(select|where|group|having|order|limit|union|except|intersect|window)$/.test(word))ctx.from=false;
    else if(token===","&&ctx.from)ctx.expect=true;
  }
  return `SELECT * FROM (${sql}) LIMIT 200`;
}
export async function query(db:D1Database, sql:string, values:unknown[]=[]) {
  await ensureSeed(db);
  const safe=safeSql(sql);
  const result=await db.prepare(safe).bind(...values).all<Record<string,unknown>>();
  const columns=Object.keys(result.results[0]||{});
  return { sql:safe, columns, rows:result.results.map(row=>columns.map(c=>row[c])), row_count:result.results.length };
}
