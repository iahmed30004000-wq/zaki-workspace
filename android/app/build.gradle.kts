plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

// ONE fixed key for every build, so a new build installs over the app already on the phones. The key file is NOT in git: the workflow
// writes android/zaki.p12 from the repository secret ANDROID_KEYSTORE_B64. The two passwords are repository secrets too, read from the
// environment (System.getenv('ANDROID_KEYSTORE_PASSWORD'), System.getenv('ANDROID_KEY_PASSWORD')): this file is public, so it never
// carries them. Without the file AND both passwords (a pull request from a fork, a build on a computer) the build uses the debug key.
val zakiKey = rootProject.file("zaki.p12")
val zakiStorePassword: String? = System.getenv("ANDROID_KEYSTORE_PASSWORD")
val zakiKeyPassword: String? = System.getenv("ANDROID_KEY_PASSWORD")
val zakiSigns = zakiKey.exists() && !zakiStorePassword.isNullOrEmpty() && !zakiKeyPassword.isNullOrEmpty()
if (zakiKey.exists() && !zakiSigns) {
    logger.warn("The key file is there but ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_PASSWORD are not set: this build is signed with the debug key.")
}

android {
    namespace = "io.zakiai.workspace"
    compileSdk = 35

    defaultConfig {
        // the app's identity on every phone: never changes
        applicationId = "io.zakiai.workspace"
        minSdk = 26
        targetSdk = 35
        // raised with every build that is handed out
        versionCode = 5
        versionName = "4.0.0"
        vectorDrawables { useSupportLibrary = true }
    }

    signingConfigs {
        create("zaki") {
            storeFile = zakiKey
            storeType = "pkcs12"
            storePassword = zakiStorePassword
            keyAlias = "zaki"
            keyPassword = zakiKeyPassword
        }
    }

    flavorDimensions += "server"
    productFlavors {
        // The real site. The one the phones get.
        create("prod") {
            dimension = "server"
            buildConfigField("String", "BASE_URL", "\"https://workspace.zakiai.io\"")
        }
        // A local copy of the site on the build machine (npm run dev -p 3100), reached from the emulator at 10.0.2.2.
        // Its own id, so it installs beside the real app and never replaces it; only this flavor may talk plain HTTP (src/staging).
        create("staging") {
            dimension = "server"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            buildConfigField("String", "BASE_URL", "\"http://10.0.2.2:3100\"")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (zakiSigns) signingConfigs.getByName("zaki") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf("-opt-in=androidx.compose.material3.ExperimentalMaterial3Api")
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.hilt.work)
    ksp(libs.hilt.work.compiler)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)

    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)

    implementation(libs.coil.compose)
    implementation(libs.security.crypto)
    implementation(libs.biometric)
    implementation(libs.splashscreen)
    implementation(libs.profileinstaller)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
}
