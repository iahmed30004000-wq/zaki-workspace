package io.zakiai.workspace.core.net

import android.os.Build
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.zakiai.workspace.BuildConfig
import io.zakiai.workspace.Config
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

/** The headers every request carries — pure, so a test can pin them. */
object AppHeaders {
    /** The site's guard lets a write through only when it comes from the site itself: the app says so, like the website's own pages do. */
    fun origin(): String = Config.BASE

    fun userAgent(versionName: String, release: String?, model: String?): String = "ZakiApp/$versionName (Android ${release ?: "?"}; ${model ?: "?"})"

    val interceptor = Interceptor { chain ->
        chain.proceed(
            chain.request().newBuilder()
                .header("Origin", origin())
                .header("Accept-Language", "ar")
                .header("User-Agent", userAgent(BuildConfig.VERSION_NAME, Build.VERSION.RELEASE, Build.MODEL))
                .build(),
        )
    }
}

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    /** Lenient on what the server adds, strict on nothing it does not send: new fields never break an old app. */
    @Provides @Singleton
    fun json(): Json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        explicitNulls = false
        isLenient = true
        encodeDefaults = true
    }

    @Provides @Singleton
    fun okHttp(jar: EncryptedCookieJar): OkHttpClient = OkHttpClient.Builder()
        .cookieJar(jar)
        .addInterceptor(AppHeaders.interceptor)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    @Provides @Singleton
    fun retrofit(client: OkHttpClient, json: Json): Retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.BASE_URL.trimEnd('/') + "/")
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    @Provides @Singleton
    fun api(retrofit: Retrofit): WorkspaceApi = retrofit.create(WorkspaceApi::class.java)
}
