// THE BASELINE PROFILE of the app: a test that opens the app's main screens on a device and records the code they run, so Android
// compiles it ahead of time on every install and update (a first start after an update is otherwise 3–5 times slower).
// Run on a signed-in emulator with the local site up: ./gradlew :app:generateBaselineProfile — the result is
// app/src/main/generated/baselineProfiles/baseline-prof.txt, committed and shipped with every build.
plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.baselineprofile)
}

android {
    namespace = "io.zakiai.workspace.baselineprofile"
    compileSdk = 35

    defaultConfig {
        minSdk = 28
        targetSdk = 35
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    targetProjectPath = ":app"

    flavorDimensions += "server"
    productFlavors {
        create("prod") { dimension = "server" }
        create("staging") { dimension = "server" }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

baselineProfile {
    useConnectedDevices = true
}

// only the local copy of the site is driven (the staging flavor): the generator never signs in to, or reads from, the real site.
// The profile it writes lands in src/main and serves both flavors (the code is the same).
androidComponents {
    beforeVariants(selector().withFlavor("server" to "prod")) { it.enable = false }
}

dependencies {
    implementation(libs.androidx.test.junit)
    implementation(libs.uiautomator)
    implementation(libs.benchmark.macro.junit4)
}
