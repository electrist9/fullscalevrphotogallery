// fsvg.exe ランチャー: zip 展開フォルダの scripts\run.ps1 を起動するだけのコンソールアプリ。
// ビルド: powershell -File scripts\build-launcher.ps1
using System;
using System.Diagnostics;
using System.IO;

class FsvgLauncher
{
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(dir, "scripts", "run.ps1");
        if (!File.Exists(script))
        {
            Console.WriteLine("エラー: fsvg.exe と同じフォルダに scripts\\run.ps1 が見つかりません。");
            Console.WriteLine("zip を展開したフォルダごと実行してください（fsvg.exe 単体では動きません）。");
            Console.ReadKey();
            return 1;
        }
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = "powershell.exe";
        psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"";
        psi.WorkingDirectory = dir;
        psi.UseShellExecute = false;
        try
        {
            Process p = Process.Start(psi);
            p.WaitForExit();
            return p.ExitCode;
        }
        catch (Exception e)
        {
            Console.WriteLine("起動に失敗しました: " + e.Message);
            Console.ReadKey();
            return 1;
        }
    }
}
