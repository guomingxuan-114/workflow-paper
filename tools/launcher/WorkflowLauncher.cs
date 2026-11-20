using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace WorkflowLauncher
{
    internal static class Program
    {
        private const string AppUrl = "http://127.0.0.1:4173/";
        private const string ProductName = "\u6D41\u7A0B\u7A3F\u7EB8";

        [STAThread]
        private static int Main(string[] args)
        {
            var baseDirectory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar);

            if (Array.IndexOf(args, "--shutdown") >= 0)
            {
                return StopService();
            }

            try
            {
                var expectedVersion = ReadExpectedVersion(baseDirectory);
                if (!IsCurrentService(expectedVersion))
                {
                    StopStaleService();
                    StartService(baseDirectory);
                }

                Process.Start(new ProcessStartInfo(
                    AppUrl + "?build=" + DateTime.UtcNow.Ticks)
                {
                    UseShellExecute = true
                });
                return 0;
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    "Could not start the local workflow service.\r\n\r\n" + error.Message,
                    ProductName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 1;
            }
        }

        private static int StopService()
        {
            try
            {
                using (var client = new WebClient())
                {
                    client.Headers[HttpRequestHeader.ContentLength] = "0";
                    client.UploadString(AppUrl + "api/shutdown", "POST", string.Empty);
                }
                MessageBox.Show(
                    "\u672C\u5730\u670D\u52A1\u5DF2\u5173\u95ED\u3002",
                    ProductName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return 0;
            }
            catch
            {
                MessageBox.Show(
                    "\u672C\u5730\u670D\u52A1\u5F53\u524D\u6CA1\u6709\u8FD0\u884C\u3002",
                    ProductName,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return 0;
            }
        }

        private static string ReadExpectedVersion(string baseDirectory)
        {
            var configPath = Path.Combine(baseDirectory, "product.config.json");
            var content = File.ReadAllText(configPath);
            var match = Regex.Match(
                content,
                "\"appVersion\"\\s*:\\s*\"([^\"]+)\"");
            if (!match.Success)
            {
                throw new InvalidDataException(
                    "Missing appVersion in product.config.json");
            }
            return match.Groups[1].Value;
        }

        private static bool IsCurrentService(string expectedVersion)
        {
            var actualVersion = GetServiceVersion();
            return actualVersion != null &&
                string.Equals(
                    actualVersion,
                    expectedVersion,
                    StringComparison.OrdinalIgnoreCase);
        }

        private static string GetServiceVersion()
        {
            try
            {
                using (var client = new WebClient())
                {
                    var body = client.DownloadString(AppUrl + "api/status");
                    var match = Regex.Match(
                        body,
                        "\"appVersion\"\\s*:\\s*\"([^\"]+)\"");
                    return match.Success ? match.Groups[1].Value : null;
                }
            }
            catch
            {
                return null;
            }
        }

        private static void StopStaleService()
        {
            if (!IsServiceReady()) return;
            try
            {
                using (var client = new WebClient())
                {
                    client.Headers[HttpRequestHeader.ContentLength] = "0";
                    client.UploadString(
                        AppUrl + "api/shutdown",
                        "POST",
                        string.Empty);
                }
            }
            catch
            {
                // Continue waiting for the stale process to exit.
            }

            for (var attempt = 0; attempt < 40; attempt++)
            {
                if (!IsServiceReady()) return;
                Thread.Sleep(250);
            }

            var listenerPid = FindListenerPid(4173);
            if (listenerPid == null)
            {
                return;
            }
            try
            {
                using (var process = Process.GetProcessById(listenerPid.Value))
                {
                    process.Kill();
                    process.WaitForExit(3000);
                }
            }
            catch
            {
                // The process may have exited between checks.
            }
            for (var attempt = 0; attempt < 20; attempt++)
            {
                if (!IsServiceReady()) return;
                Thread.Sleep(200);
            }
            throw new TimeoutException(
                "The previous local service did not stop.");
        }

        private static int? FindListenerPid(int port)
        {
            try
            {
                using (var process = Process.Start(new ProcessStartInfo("netstat")
                {
                    Arguments = "-ano -p tcp",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                }))
                {
                    if (process == null) return null;
                    var output = process.StandardOutput.ReadToEnd();
                    process.WaitForExit(2000);
                    foreach (var line in output.Split(
                        new[] { '\r', '\n' },
                        StringSplitOptions.RemoveEmptyEntries))
                    {
                        if (!line.Contains("LISTENING") ||
                            !line.Contains(":" + port + " "))
                        {
                            continue;
                        }
                        var parts = Regex.Split(
                            line.Trim(),
                            "\\s+");
                        int value;
                        if (parts.Length > 0 &&
                            int.TryParse(parts[parts.Length - 1], out value))
                        {
                            return value;
                        }
                    }
                }
            }
            catch
            {
                // Fall through to a normal start attempt.
            }
            return null;
        }

        private static void StartService(string baseDirectory)
        {
            var script = Path.Combine(baseDirectory, "scripts", "local-host.mjs");
            if (!File.Exists(script))
            {
                throw new FileNotFoundException("Missing local-host.mjs", script);
            }

            var node = FindNode();
            if (node == null)
            {
                throw new FileNotFoundException("Node.js runtime was not found.");
            }

            var process = Process.Start(new ProcessStartInfo(node)
            {
                Arguments = Quote(script) + " --dev",
                WorkingDirectory = baseDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });

            if (process == null)
            {
                throw new InvalidOperationException("The local service process could not be created.");
            }

            for (var attempt = 0; attempt < 80; attempt++)
            {
                Thread.Sleep(250);
                if (IsServiceReady())
                {
                    return;
                }
            }

            throw new TimeoutException("The local service did not become ready in 20 seconds.");
        }

        private static string FindNode()
        {
            var candidates = new List<string>
            {
                Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".cache",
                    "codex-runtimes",
                    "codex-primary-runtime",
                    "dependencies",
                    "node",
                    "bin",
                    "node.exe"),
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe"
            };

            var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            foreach (var directory in path.Split(';'))
            {
                if (!string.IsNullOrWhiteSpace(directory))
                {
                    candidates.Add(Path.Combine(directory.Trim(), "node.exe"));
                }
            }

            foreach (var candidate in candidates)
            {
                try
                {
                    if (File.Exists(candidate))
                    {
                        return candidate;
                    }
                }
                catch
                {
                    // Ignore inaccessible PATH entries.
                }
            }
            return null;
        }

        private static bool IsServiceReady()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(AppUrl + "api/status");
                request.Timeout = 500;
                request.ReadWriteTimeout = 500;
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }
    }
}
