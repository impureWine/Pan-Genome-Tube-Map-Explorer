# Pan-Genome Tube Map Explorer

当前实现：**Step 1 — GFA 解析与 SQLite 存储索引**。运行环境 Python 3.10+，仅使用标准库。尚未实现 API、布局或前端。

## 运行（PowerShell）

```powershell
cd 'D:\大学\生物信息学项目\Pan-Genome-Tube-Map-Explorer'
python backend/seed_mock_gfa.py
python -m unittest backend.test_data_layer -v
```

默认输出 `backend/data/sample_pangenome.gfa` 和 `backend/data/pangenome.db`。仓库包含已生成样例；再次运行时请选择新目录，程序拒绝覆盖已有文件：

```powershell
python backend/seed_mock_gfa.py --output-dir backend/data-local
python backend/gfa_parser.py backend/data/sample_pangenome.gfa backend/custom.db --reference GRCh38
```

解析器的目标数据库必须为空。第一次 P 记录默认作为参考，也可用 `--reference` 显式选择。所有数据写入使用事务；解析失败不会写入半份图数据。测试使用临时目录保留测试夹具，不主动删除文件。

## 数据结构与坐标

- `nodes`：字符串 GFA ID、序列、长度、主干标志、参考区间；`*` 序列必须提供 `LN:i:`。
- `edges`：有向 GFA 连边与双方方向、原始 overlap CIGAR、`normal/insertion/deletion/inversion` 类型。反向互补连边隐式可用，不重复存储。
- `paths`：样本主键、分组、JSON 步骤数组，格式 `[{"node_id":"1","orientation":"+"}]`。分组读取自可选 `GN:Z:` 标签，缺省 `Unknown`。
- 参考坐标使用 **0-based 半开区间**。主干累计序列长度并扣除相邻 overlap；参考中的重复节点无法用单一区间表示，明确拒绝。
- 非主干节点按连通分量收集主干锚点，投影至最左锚点末端和最右锚点起点之间。多跳分支和环使用同一区间；只有一个锚点时采用该锚点区间；无锚点时为 NULL，不参与参考区间查询。这是保守近似，不是序列比对。
- 相邻主干间插入投影为零宽坐标，查询区间包含该点时召回；SNP 替代节点投影到被替代参考区间。
- 建立 `ref_start/ref_end` B-tree 索引及 `rtree_i32` 区间索引，触发器同步索引。支持单参考坐标范围 0–2,147,483,647；超范围拒绝导入。
- SV 分类是拓扑启发式：参考相邻边 normal；反向参考遍历 inversion；接触零宽分支 insertion；跳过参考区间 deletion。SNP 连边记 normal（给定枚举没有 SNP）。真实复杂图的最终变异判定需要比对和样本上下文。
- 支持 GFA 1.0/1.1 的 H/S/L/P；其他记录明确报错。参考 overlap 为 `*` 时从 L 推导；缺失或歧义时拒绝。不会尝试构建未知重叠坐标。

## 模拟变异

固定随机种子 `20261105`，62 个节点（60 主干 + 2 变异），参考长度 5901 bp，6 个样本：

| 样本 | 分组 | 路径特征 |
|---|---|---|
| GRCh38 | Control | 参考 |
| HG002 | Control | 节点 10 的单碱基 SNP 气泡，区间 [900,901) |
| HG005 | Case | 节点 20 与 21 间插入 500 bp，锚点 1901 |
| HG007 | Case | 删除节点 30–39，共 1000 bp，区间 [2801,3801) |
| HG011 | Case | 节点 45–49 倒位，按 49- 到 45- 遍历，形成倒位回环 |
| HG020 | Case | 同时携带以上四类事件 |

## 本地验收

```powershell
python -c "from backend.database import connect,statistics; import json; c=connect('backend/data/pangenome.db'); print(json.dumps(statistics(c),indent=2)); print(c.execute('PRAGMA integrity_check').fetchone()[0]); print(c.execute('PRAGMA foreign_key_check').fetchall()); c.close()"
python -c "from backend.database import connect,query_region; c=connect('backend/data/pangenome.db'); print(query_region(c,900,901)); print(query_region(c,1901,1902)); c.close()"
python -c "from backend.database import connect; c=connect('backend/data/pangenome.db'); print([tuple(r) for r in c.execute('SELECT sample_id,group_name,json_array_length(node_path) FROM paths')]); print([tuple(r) for r in c.execute('SELECT sv_type,count(*) FROM edges GROUP BY sv_type')]); c.close()"
```

预期：62 nodes、66 edges、6 paths、60 backbone nodes、62 anchored nodes；边类型为 normal=61、insertion=2、deletion=1、inversion=2；完整性 `ok`，外键异常 `[]`。SNP 区间召回 `10` 和 `snp_alt`，插入锚点召回 `21` 和 `ins_500`。单元测试覆盖四类变异、半开边界、多跳锚定、孤立节点、反向重叠、索引计划和非法输入。
