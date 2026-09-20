// GitHub 加速器提权辅助程序
// 带 requireAdministrator 清单：被启动时触发 UAC，提权后把暂存文件复制到目标(hosts)路径。
// 避免使用脚本/PowerShell，降低杀软启发式误报。
//
// 参数：src dst [result]
//   result 为可选的"结果文件"路径，复制失败/成功时把真实原因写入，
//   供主进程诊断（需与 src/main/hosts.ts 的 elevateViaStartProcess 配合使用）。
//
// 退出码：
//   0 成功；1 复制失败(已写 detail)；2 参数不足；3 复制完成但目标不存在
using System;
using System.IO;

internal class ElevateCopy
{
    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            return 2; // 参数不足
        }
        string src = args[0];
        string dst = args[1];
        string result = args.Length > 2 ? args[2] : null;
        try
        {
            NormalizeAttributes(dst);
            // 方案一：File.Copy（快路径）
            try
            {
                File.Copy(src, dst, true);
            }
            catch (Exception copyEx)
            {
                // 方案二：hosts 常被其它进程(DNS/杀软)以只读共享方式占用，
                // File.Copy 走 FileShare.None 会抛"文件正被另一进程使用"。
                // 改用带 FileShare.ReadWrite 的文件流覆盖写入，通常仍可成功。
                try
                {
                    using (var ins = File.OpenRead(src))
                    using (var outs = new FileStream(dst, FileMode.Create, FileAccess.Write, FileShare.ReadWrite))
                    {
                        ins.CopyTo(outs);
                    }
                }
                catch (Exception streamEx)
                {
                    WriteResult(result, string.Join(" | ", copyEx.Message, streamEx.Message));
                    return 1;
                }
            }
            NormalizeAttributes(dst);
            bool ok = File.Exists(dst);
            WriteResult(result, ok ? "OK" : "目标文件不存在");
            return ok ? 0 : 3;
        }
        catch (Exception ex)
        {
            string msg = ex.Message;
            if (ex.InnerException != null)
            {
                msg += Environment.NewLine + ex.InnerException.Message;
            }
            WriteResult(result, msg);
            return 1;
        }
    }

    // 清除/恢复只读属性，避免已标记只读时无法覆盖；失败不阻塞，交由写入兜底报错
    private static void NormalizeAttributes(string dst)
    {
        try
        {
            if (File.Exists(dst))
            {
                var attrs = File.GetAttributes(dst);
                File.SetAttributes(dst, attrs & ~FileAttributes.ReadOnly);
            }
        }
        catch
        {
            /* 忽略 */
        }
    }

    private static void WriteResult(string result, string msg)
    {
        if (string.IsNullOrEmpty(result)) return;
        try
        {
            File.WriteAllText(result, msg);
        }
        catch
        {
            /* 结果文件写失败不影响主流程，主进程会读不到 detail 使用通用提示 */
        }
    }
}