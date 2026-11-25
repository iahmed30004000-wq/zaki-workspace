pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // LiveKit's audio routing (earpiece, speaker, Bluetooth) is published on JitPack only, as its own setup guide says
        maven { url = uri("https://jitpack.io"); content { includeGroup("com.github.davidliu") } }
    }
}

rootProject.name = "zaki-workspace-android"
include(":app")
