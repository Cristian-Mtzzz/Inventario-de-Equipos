using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Persistencia de los catálogos de ubicación y tipos de dispositivo que alimentan
// los formularios y el módulo de mantenimiento.
public sealed class CatalogService(InventoryDbContext dbContext) : OracleRepository(dbContext), ICatalogService
{
    public Task<IReadOnlyList<DeviceTypeDto>> GetDeviceTypes(CancellationToken cancellationToken) =>
        ReadList("SELECT ID_TIPO, TIPO_DISPOSITIVO FROM TIPOS_DISPOSITIVOS ORDER BY TIPO_DISPOSITIVO",
            reader => new DeviceTypeDto(
                ReadInt(reader, "ID_TIPO"),
                ReadString(reader, "TIPO_DISPOSITIVO")), cancellationToken);

    public Task CreateDeviceType(SaveDeviceTypeDto deviceType, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var idTipo = await NextId(connection, transaction, "TIPOS_DISPOSITIVOS", "ID_TIPO", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO TIPOS_DISPOSITIVOS (ID_TIPO, TIPO_DISPOSITIVO) VALUES (:idTipo, :nombre)
                """, cancellationToken, ("idTipo", idTipo), ("nombre", deviceType.TipoDispositivo.Trim()));
        }, cancellationToken);

    public async Task<bool> UpdateDeviceType(int idTipo, SaveDeviceTypeDto deviceType, CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE TIPOS_DISPOSITIVOS
            SET TIPO_DISPOSITIVO = :nombre
            WHERE ID_TIPO = :idTipo
            """, cancellationToken, ("nombre", deviceType.TipoDispositivo.Trim()), ("idTipo", idTipo)) == 1;

    public async Task<bool> DeleteDeviceType(int idTipo, CancellationToken cancellationToken) =>
        await Execute("DELETE FROM TIPOS_DISPOSITIVOS WHERE ID_TIPO = :idTipo", cancellationToken,
            ("idTipo", idTipo)) == 1;

    public Task<IReadOnlyList<BuildingDto>> GetBuildings(CancellationToken cancellationToken) =>
        ReadList("""
            SELECT b.EDIFICIO_ID, b.EDIFICIO_DESCRIPCION,
                   b.REGIONA_ID AS ID_REGIONAL, r.DESCRIPCION AS NOMBRE_REGIONAL
            FROM EDIFICIO b
            LEFT JOIN REGIONAL r ON r.REGIONA_ID = b.REGIONA_ID
            ORDER BY b.EDIFICIO_DESCRIPCION
            """, reader => new BuildingDto(
                ReadInt(reader, "EDIFICIO_ID"),
                ReadString(reader, "EDIFICIO_DESCRIPCION"),
                ReadNullableInt(reader, "ID_REGIONAL"),
                ReadNullableString(reader, "NOMBRE_REGIONAL")), cancellationToken);

    public Task<IReadOnlyList<AreaDto>> GetAreas(int idEdificio, CancellationToken cancellationToken) =>
        ReadList("""
            SELECT DEPARTAMENTO_IHSS_ID AS ID_AREA, DEPARTAMENTO_IHSS_DESC AS NOMBRE_AREA
            FROM DEPARTAMENTO_IHSS
            WHERE EDIFICIO_ID = :idEdificio
            ORDER BY DEPARTAMENTO_IHSS_DESC
            """, reader => new AreaDto(
                ReadInt(reader, "ID_AREA"),
                ReadString(reader, "NOMBRE_AREA")), cancellationToken, ("idEdificio", idEdificio));

    public Task<IReadOnlyList<RegionalDto>> GetRegionals(CancellationToken cancellationToken) =>
        ReadList("SELECT REGIONA_ID, DESCRIPCION FROM REGIONAL ORDER BY UPPER(DESCRIPCION)",
            reader => new RegionalDto(
                ReadInt(reader, "REGIONA_ID"),
                ReadString(reader, "DESCRIPCION")), cancellationToken);

    public Task<IReadOnlyList<CatalogDepartmentDto>> GetCatalogDepartments(CancellationToken cancellationToken) =>
        ReadList("""
            SELECT a.DEPARTAMENTO_IHSS_ID AS ID_AREA,
                   a.DEPARTAMENTO_IHSS_DESC AS NOMBRE_AREA,
                   b.EDIFICIO_ID AS ID_EDIFICIO,
                   b.EDIFICIO_DESCRIPCION AS NOMBRE_EDIFICIO,
                   COALESCE(a.REGIONA_ID, b.REGIONA_ID) AS ID_REGIONAL,
                   r.DESCRIPCION AS NOMBRE_REGIONAL
            FROM DEPARTAMENTO_IHSS a
            JOIN EDIFICIO b ON b.EDIFICIO_ID = a.EDIFICIO_ID
            LEFT JOIN REGIONAL r ON r.REGIONA_ID = COALESCE(a.REGIONA_ID, b.REGIONA_ID)
            ORDER BY UPPER(r.DESCRIPCION), UPPER(b.EDIFICIO_DESCRIPCION), UPPER(a.DEPARTAMENTO_IHSS_DESC)
            """, reader => new CatalogDepartmentDto(
                ReadInt(reader, "ID_AREA"),
                ReadString(reader, "NOMBRE_AREA"),
                ReadInt(reader, "ID_EDIFICIO"),
                ReadString(reader, "NOMBRE_EDIFICIO"),
                ReadNullableInt(reader, "ID_REGIONAL"),
                ReadNullableString(reader, "NOMBRE_REGIONAL")), cancellationToken);

    public Task CreateRegional(SaveRegionalDto regional, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var idRegional = await NextId(connection, transaction, "REGIONAL", "REGIONA_ID", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO REGIONAL (REGIONA_ID, DESCRIPCION) VALUES (:idRegional, :nombre)
                """, cancellationToken, ("idRegional", idRegional), ("nombre", regional.NombreRegional.Trim()));
        }, cancellationToken);

    public async Task<bool> UpdateRegional(int idRegional, SaveRegionalDto regional, CancellationToken cancellationToken) =>
        await Execute("UPDATE REGIONAL SET DESCRIPCION = :nombre WHERE REGIONA_ID = :idRegional", cancellationToken,
            ("nombre", regional.NombreRegional.Trim()), ("idRegional", idRegional)) == 1;

    public async Task<bool> DeleteRegional(int idRegional, CancellationToken cancellationToken) =>
        await Execute("DELETE FROM REGIONAL WHERE REGIONA_ID = :idRegional", cancellationToken,
            ("idRegional", idRegional)) == 1;

    public Task CreateBuilding(SaveBuildingDto building, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var idEdificio = await NextId(connection, transaction, "EDIFICIO", "EDIFICIO_ID", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO EDIFICIO (EDIFICIO_ID, EDIFICIO_DESCRIPCION, REGIONA_ID)
                VALUES (:idEdificio, :nombre, :idRegional)
                """, cancellationToken, ("idEdificio", idEdificio),
                ("nombre", building.NombreEdificio.Trim()), ("idRegional", building.IdRegional));
        }, cancellationToken);

    public async Task<bool> UpdateBuilding(int idEdificio, SaveBuildingDto building, CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE EDIFICIO
            SET EDIFICIO_DESCRIPCION = :nombre, REGIONA_ID = :idRegional
            WHERE EDIFICIO_ID = :idEdificio
            """, cancellationToken, ("nombre", building.NombreEdificio.Trim()), ("idRegional", building.IdRegional),
            ("idEdificio", idEdificio)) == 1;

    public async Task<bool> DeleteBuilding(int idEdificio, CancellationToken cancellationToken) =>
        await Execute("DELETE FROM EDIFICIO WHERE EDIFICIO_ID = :idEdificio", cancellationToken,
            ("idEdificio", idEdificio)) == 1;

    public Task CreateDepartment(SaveDepartmentDto department, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var idArea = await NextId(connection, transaction, "DEPARTAMENTO_IHSS", "DEPARTAMENTO_IHSS_ID", cancellationToken);
            // La regional del departamento se hereda del edificio seleccionado.
            await Execute(connection, transaction, """
                INSERT INTO DEPARTAMENTO_IHSS
                    (DEPARTAMENTO_IHSS_ID, DEPARTAMENTO_IHSS_DESC, EDIFICIO_ID, REGIONA_ID)
                SELECT :idArea, :nombre, b.EDIFICIO_ID, b.REGIONA_ID
                FROM EDIFICIO b
                WHERE b.EDIFICIO_ID = :idEdificio
                """, cancellationToken, ("idArea", idArea),
                ("nombre", department.NombreArea.Trim()), ("idEdificio", department.IdEdificio));
        }, cancellationToken);

    public async Task<bool> UpdateDepartment(int idArea, SaveDepartmentDto department, CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE DEPARTAMENTO_IHSS
            SET DEPARTAMENTO_IHSS_DESC = :nombre,
                EDIFICIO_ID = :idEdificio,
                REGIONA_ID = (SELECT b.REGIONA_ID FROM EDIFICIO b WHERE b.EDIFICIO_ID = :idEdificio)
            WHERE DEPARTAMENTO_IHSS_ID = :idArea
            """, cancellationToken, ("nombre", department.NombreArea.Trim()), ("idEdificio", department.IdEdificio),
            ("idArea", idArea)) == 1;

    public async Task<bool> DeleteDepartment(int idArea, CancellationToken cancellationToken) =>
        await Execute("DELETE FROM DEPARTAMENTO_IHSS WHERE DEPARTAMENTO_IHSS_ID = :idArea", cancellationToken,
            ("idArea", idArea)) == 1;
}
