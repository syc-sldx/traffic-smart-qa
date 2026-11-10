import {DatabaseSync} from "node:sqlite";
import {mkdirSync,readFileSync,readdirSync} from "node:fs";
import {dirname,join} from "node:path";
import {createHash} from "node:crypto";

export function openDatabase(path,migrationsPath){
  if(path!==":memory:")mkdirSync(dirname(path),{recursive:true});
  const native=new DatabaseSync(path,{timeout:5000});
  native.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  native.exec("CREATE TABLE IF NOT EXISTS app_migrations(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL)");
  for(const name of readdirSync(migrationsPath).filter(n=>n.endsWith(".sql")).sort()){
    const sql=readFileSync(join(migrationsPath,name),"utf8"),hash=createHash("sha256").update(sql).digest("hex");
    const previous=native.prepare("SELECT sha256 FROM app_migrations WHERE name=?").get(name);
    if(previous){if(previous.sha256!==hash)throw new Error("已应用的数据库迁移发生变化："+name);continue;}
    native.exec("BEGIN IMMEDIATE");
    try{native.exec(sql);native.prepare("INSERT INTO app_migrations(name,sha256) VALUES(?,?)").run(name,hash);native.exec("COMMIT");}
    catch(error){native.exec("ROLLBACK");throw error;}
  }
  const db={
    prepare(sql){
      const statement=native.prepare(sql);
      function bound(values){return {
        bind(...args){return bound(args);},
        execute(){return statement.run(...values);},
        async run(){const r=statement.run(...values);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};},
        async first(column){const row=statement.get(...values);return row?(column?row[column]:row):null;},
        async all(){return {success:true,results:statement.all(...values)};}
      };}
      return bound([]);
    },
    async batch(statements){
      native.exec("BEGIN IMMEDIATE");
      try{const result=statements.map(s=>s.execute());native.exec("COMMIT");return result;}
      catch(error){native.exec("ROLLBACK");throw error;}
    },
    close(){native.close();}
  };
  return db;
}
