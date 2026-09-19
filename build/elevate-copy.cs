// GitHub 加速器提权辅助程序
// 带 requireAdministrator 清单：被启动时触发 UAC，提权后把暂存文件复制到目标(hosts)路径。
// 避免使用脚本/PowerShell，降低杀软启发式误报。
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
        try
        {
            File.Copy(src, dst, true);
            return File.Exists(dst) ? 0 : 3;
        }
        catch (Exception ex)
        {
            try { Console.Error.WriteLine(ex.Message); } catch { /* 忽略写错误输出失败 */ }
            return 1;
        }
    }
}