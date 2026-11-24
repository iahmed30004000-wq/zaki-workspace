# kotlinx.serialization: keep the generated serializers of the API models.
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class io.zakiai.workspace.**$$serializer { *; }
-keepclassmembers class io.zakiai.workspace.** { *** Companion; }
-keepclasseswithmembers class io.zakiai.workspace.** { kotlinx.serialization.KSerializer serializer(...); }

# Retrofit interfaces are read by reflection.
-keep,allowobfuscation interface io.zakiai.workspace.core.net.** { *; }
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-dontwarn retrofit2.**
-dontwarn okhttp3.**
-dontwarn okio.**
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response

# Tink (under EncryptedSharedPreferences) refers to compile-time-only annotations.
-dontwarn com.google.errorprone.annotations.**

# Crash reports stay readable: keep line numbers.
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
