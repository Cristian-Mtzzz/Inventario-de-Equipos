-- Cambios requeridos para el nuevo registro de usuarios.
-- Ejecutar con el usuario propietario de la tabla USUARIOS.
-- Agrega cada columna solo si todavía no existe, para poder ejecutarse
-- sin error sin importar qué tan avanzado esté el esquema actual.
DECLARE
    PROCEDURE add_column_if_missing(
        p_column_name IN VARCHAR2,
        p_ddl IN VARCHAR2
    ) IS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*)
        INTO v_count
        FROM USER_TAB_COLUMNS
        WHERE UPPER(TABLE_NAME) = 'USUARIOS'
          AND UPPER(COLUMN_NAME) = p_column_name;

        IF v_count = 0 THEN
            EXECUTE IMMEDIATE p_ddl;
        END IF;
    END;
BEGIN
    add_column_if_missing('NOMBRE_PERSONA', 'ALTER TABLE USUARIOS ADD NOMBRE_PERSONA VARCHAR2(150)');
    add_column_if_missing('FECHA_EXPIRACION', 'ALTER TABLE USUARIOS ADD FECHA_EXPIRACION DATE');
    add_column_if_missing('ESTADO', 'ALTER TABLE USUARIOS ADD ESTADO VARCHAR2(10)');
END;
/

UPDATE USUARIOS
SET ESTADO = NVL(ESTADO, 'ACTIVO'),
    CLAVE_SEGURA = NVL(CLAVE_SEGURA, '1'),
    DOMINIOP = UPPER(TRIM(DOMINIOP));

COMMIT;