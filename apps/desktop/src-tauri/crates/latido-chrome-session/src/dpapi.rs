//! Pegamento del sistema: DPAPI.
//!
//! Aquí está lo único que no se puede probar fuera de Windows: la llamada real a
//! `CryptUnprotectData`. Todo lo demás del módulo es lógica pura. Por eso esto
//! vive en un archivo de veinte líneas y no en medio del algoritmo.

/// Descifra con DPAPI un bloque protegido para el usuario actual de Windows.
///
/// Es el paso que hace imposible leer la sesión de otra persona: la clave de
/// Chrome está protegida con la identidad del usuario que abrió el navegador. Si
/// esto falla, la aplicación lo dice y no sigue.
#[cfg(windows)]
pub fn dpapi_unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    if data.is_empty() {
        return Err("no hay datos que descifrar".to_string());
    }

    // `CryptUnprotectData` no modifica la entrada, pero la firma pide un puntero
    // mutable: se le pasa una copia para no tocar el búfer del llamante.
    let mut input = data.to_vec();
    let mut blob_in = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_mut_ptr(),
    };
    let mut blob_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut blob_in,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut blob_out,
        )
    };

    if ok == 0 {
        return Err(format!(
            "CryptUnprotectData ha fallado ({})",
            std::io::Error::last_os_error()
        ));
    }
    if blob_out.pbData.is_null() {
        return Err("DPAPI no ha devuelto ningún dato".to_string());
    }

    let plain = unsafe { std::slice::from_raw_parts(blob_out.pbData, blob_out.cbData as usize).to_vec() };
    unsafe {
        LocalFree(blob_out.pbData as *mut core::ffi::c_void);
    }
    Ok(plain)
}

/// Fuera de Windows no hay DPAPI, así que la sesión de Chrome no se puede leer.
/// Se dice tal cual en lugar de devolver algo vacío que parezca un éxito.
#[cfg(not(windows))]
pub fn dpapi_unprotect(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err(
        "DPAPI solo existe en Windows: en este sistema no se puede descifrar la sesión de Chrome"
            .to_string(),
    )
}
