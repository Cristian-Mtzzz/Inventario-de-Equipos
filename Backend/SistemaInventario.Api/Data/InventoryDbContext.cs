using Microsoft.EntityFrameworkCore;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Data;

// Contexto EF Core. Mapea USUARIOS al esquema empresarial y administra la conexión
// que comparten los servicios que ejecutan SQL directo sobre Oracle.
public sealed class InventoryDbContext(DbContextOptions<InventoryDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("USUARIOS");
            entity.HasKey(user => user.UserId);
            entity.Property(user => user.UserId).HasColumnName("ID_USUARIO");
            entity.Property(user => user.UserName).HasColumnName("USUARIO").HasMaxLength(100);
            entity.Property(user => user.PasswordHash).HasColumnName("PASSWORD_HASH").HasMaxLength(256);
            entity.Property(user => user.Role).HasColumnName("ROL").HasMaxLength(30);
        });
    }
}