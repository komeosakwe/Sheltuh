import UIKit
import Capacitor

/// Keeps the WebView's website data (localStorage, and so the signed-in Supabase session) and
/// cookies out of iCloud and computer backups, so restoring a backup on another phone doesn't
/// restore the session (docs/mobile-app.md, "Storage and backups"). WebKit keeps them under
/// Library/WebKit and Library/Cookies. Only folders that exist are marked: at first launch the
/// WebView hasn't made them yet, so SceneDelegate runs this again when the app goes to the
/// background. Not yet compiled or run on a device: see the checklist in docs/mobile-app.md.
func excludeWebViewDataFromBackup() {
    let fileManager = FileManager.default
    guard let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
    for name in ["WebKit", "Cookies"] {
        var folder = library.appendingPathComponent(name, isDirectory: true)
        guard fileManager.fileExists(atPath: folder.path) else { continue }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        do {
            try folder.setResourceValues(values)
        } catch {
            CAPLog.print("Couldn't exclude \(name) from backups: \(error.localizedDescription)")
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        excludeWebViewDataFromBackup()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
