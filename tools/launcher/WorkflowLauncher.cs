using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
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
                if (!IsServiceReady())
                {
                    StartService(baseDirectory);
                }

                Process.Start(new ProcessStartInfo(AppUrl)
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
