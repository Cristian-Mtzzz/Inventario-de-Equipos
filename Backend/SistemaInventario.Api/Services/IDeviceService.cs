using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato de consulta y mantenimiento de dispositivos.
public interface IDeviceService
{
    Task<PagedResult<DeviceDto>> GetDevices(
        int page,
        int pageSize,
        string? searchTerm,
        string? brand,
        string? model,
        int? typeId,
        int? regionalId,
        int? buildingId,
        int? areaId,
        string? state,
        bool comboOnly,
        CancellationToken cancellationToken);
    Task<IReadOnlyList<DeviceOptionDto>> SearchDeviceOptions(string searchTerm, CancellationToken cancellationToken);
    Task CreateDevice(CreateDeviceDto device, CancellationToken cancellationToken);
    Task CreateDesktopCombo(CreateDesktopComboDto combo, CancellationToken cancellationToken);
    Task<bool> UpdateDevice(int idEquipo, CreateDeviceDto device, bool applyToCombo, CancellationToken cancellationToken);
    Task<bool> DeleteDevice(int idEquipo, CancellationToken cancellationToken);
}
